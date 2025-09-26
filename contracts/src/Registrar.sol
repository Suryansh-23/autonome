// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {StringUtils} from "@ensdomains/ens-contracts/utils/StringUtils.sol";
import {IL2Registry} from "@durin/contracts/interfaces/IL2Registry.sol";
import {FunctionsClient} from "@chainlink/contracts/functions/v1_0_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/contracts/functions/v1_0_0/libraries/FunctionsRequest.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {Log, ILogAutomation} from "@chainlink/contracts/automation/interfaces/ILogAutomation.sol";

contract Registrar is Ownable, FunctionsClient, IERC721Receiver, ILogAutomation {
    using StringUtils for string;

    /// @notice Reference to the target registry contract
    IL2Registry public immutable registry;

    /// @notice The coinType for the current chain (ENSIP-11)
    uint256 public immutable coinType;

    // Chainlink Functions configuration
    uint64 public subscriptionId;
    bytes32 public donId;
    uint32 public gasLimit = 300_000;
    address public automationRegistry;

    // Domain verification tracking
    struct Registration {
        address owner;
        string fullDomain;
        uint256 registrationTime;
        bool verified;
    }

    struct PendingRegistration {
        string[] domainParts;
        string fullDomain;
        address requester;
    }

    // Track registrations: node => Registration
    mapping(bytes32 => Registration) public registrations;

    // Track pending registrations by request ID
    mapping(bytes32 => PendingRegistration) public pendingRegistrations;

    // Track which domains have been verified
    mapping(string => bool) public domainVerified;

    // Chainlink verification source code
    string private constant VERIFICATION_SOURCE = "const domain = args[0];" "const address = args[1];"
        "const headRequest = await Functions.makeHttpRequest({" "  url: `https://${domain}`," "  method: 'HEAD',"
        "  responseType: 'text'" "});" "const response = await headRequest;" "if (response.error) {"
        "  throw Error('Request failed');" "}" "const responseAddress = response.headers['x-payment-address'];"
        "if (!responseAddress) {" "  return Functions.encodeUint256(0);" "}"
        "if (responseAddress.toLowerCase() !== address.toLowerCase()) {" "  return Functions.encodeUint256(0);" "}"
        "return Functions.encodeUint256(1);";

    string private constant FAVICON_ICON_BASE_URL = "https://favicon.is/";

    /// @notice Emitted when a new name is registered
    /// @param label The registered label (e.g. "bob" in "bob.github.io.x0x0.eth")
    /// @param node The node hash of the registered name
    /// @param owner The owner of the newly registered name
    event NameRegistered(string indexed label, bytes32 indexed node, address indexed owner);

    /// @notice Emitted when domain verification is requested
    event DomainVerificationRequested(string fullDomain, address requester, bytes32 requestId);

    /// @notice Emitted when domain is verified
    event DomainVerified(bytes32 indexed requestId);

    /// @notice Emitted when domain is registered
    event DomainRegistered(string fullDomain, address owner);

    error Registrar__InvalidDomain();
    error Registrar__DomainNotAvailable();
    error Registrar__NotOwner();
    error Registrar__InvalidAddress();

    /// @notice Initializes the registrar with a registry contract
    /// @param _initialOwner The initial owner of the contract
    /// @param _registry Address of the L2Registry contract
    /// @param _functionsRouter Address of the Chainlink Functions router
    /// @param _donId DON ID for Chainlink Functions
    /// @param _subscriptionId Subscription ID for Chainlink Functions
    constructor(
        address _initialOwner,
        address _registry,
        address _functionsRouter,
        bytes32 _donId,
        uint64 _subscriptionId,
        address _automationRegistry
    ) Ownable(_initialOwner) FunctionsClient(_functionsRouter) {
        coinType = 0x80000000 | block.chainid;

        registry = IL2Registry(_registry);

        donId = _donId;
        subscriptionId = _subscriptionId;
        automationRegistry = _automationRegistry;
    }

    /// @notice Registers a new domain with verification
    /// @param fullDomain The full domain to register (e.g. "bob.github.io")
    function requestRegistration(string calldata fullDomain) external {
        if (bytes(fullDomain).length == 0) revert Registrar__InvalidDomain();

        // Parse domain into parts
        string[] memory domainParts = _parseDomain(fullDomain);
        if (domainParts.length == 0) revert Registrar__InvalidDomain();

        // Check if the final domain node is available
        bytes32 finalNode = _buildNodeFromParts(domainParts);
        if (!_isNodeAvailable(finalNode)) revert Registrar__DomainNotAvailable();

        // Create Chainlink Functions request for domain verification
        FunctionsRequest.Request memory req;
        FunctionsRequest.initializeRequestForInlineJavaScript(req, VERIFICATION_SOURCE);

        string[] memory args = new string[](2);
        args[0] = fullDomain;
        args[1] = Strings.toHexString(uint160(msg.sender), 20);
        FunctionsRequest.setArgs(req, args);

        bytes32 requestId = _sendRequest(FunctionsRequest.encodeCBOR(req), subscriptionId, gasLimit, donId);

        // Store pending registration
        pendingRegistrations[requestId] =
            PendingRegistration({domainParts: domainParts, fullDomain: fullDomain, requester: msg.sender});

        emit DomainVerificationRequested(fullDomain, msg.sender, requestId);
    }

    function fulfillRequest(bytes32 requestId, bytes memory response, bytes memory err) internal override {
        PendingRegistration memory pending = pendingRegistrations[requestId];
        if (pending.requester == address(0)) {
            return;
        }

        uint256 verified;
        if (err.length == 0 && response.length > 0) {
            verified = abi.decode(response, (uint256));
        }

        if (verified == 1) {
            emit DomainVerified(requestId);
        }
    }

    function checkLog(Log calldata log, bytes memory checkData)
        external
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        return (true, abi.encode(log.topics[1]));
    }

    function performUpkeep(bytes calldata performData) external override {
        bytes32 requestId = abi.decode(performData, (bytes32));
        PendingRegistration memory pending = pendingRegistrations[requestId];
        if (pending.requester == address(0)) {
            return;
        }

        domainVerified[pending.fullDomain] = true;

        _registerDomainHierarchy(pending.domainParts, pending.fullDomain, pending.requester);

        emit DomainRegistered(pending.fullDomain, pending.requester);

        delete pendingRegistrations[requestId];
    }

    /// @notice Registers a domain hierarchy (creates parent domains if needed)
    function _registerDomainHierarchy(string[] memory domainParts, string memory fullDomain, address owner) internal {
        bytes32 currentNode = registry.baseNode();

        // Register each level of the hierarchy
        for (uint256 i = domainParts.length; i > 0; i--) {
            string memory label = domainParts[i - 1];
            bytes32 newNode = registry.makeNode(currentNode, label);

            // Check if this node already exists
            if (_isNodeAvailable(newNode)) {
                // Create the subnode
                currentNode = registry.createSubnode(
                    currentNode,
                    label,
                    (i == 1) ? owner : address(this), // Final level goes to user, intermediates to contract
                    new bytes[](0)
                );

                // Set address record for the final domain
                if (i == 1) {
                    bytes memory addr = abi.encodePacked(owner);
                    registry.setAddr(currentNode, 60, addr); // ETH mainnet
                    registry.setAddr(currentNode, coinType, addr); // Current chain

                    // Store registration info
                    registrations[currentNode] = Registration({
                        owner: owner,
                        fullDomain: fullDomain,
                        registrationTime: block.timestamp,
                        verified: true
                    });

                    string memory facivonIcon = string.concat(FAVICON_ICON_BASE_URL, fullDomain);
                    registry.setText(currentNode, "avatar", facivonIcon);
                }

                emit NameRegistered(label, currentNode, (i == 1) ? owner : address(this));
            } else {
                // Node exists, just move to it
                currentNode = newNode;
            }
        }
    }

    /// @notice Parses a domain string into its components
    /// @param domain The domain to parse (e.g. "bob.github.io")
    /// @return An array of domain parts ["bob", "github", "io"]
    function _parseDomain(string memory domain) internal pure returns (string[] memory) {
        bytes memory domainBytes = bytes(domain);
        uint256 partCount = 1;

        for (uint256 i; i < domainBytes.length; ++i) {
            if (domainBytes[i] == ".") {
                ++partCount;
            }
        }

        string[] memory parts = new string[](partCount);
        uint256 partIndex;
        uint256 start;

        for (uint256 i; i <= domainBytes.length; ++i) {
            if (i == domainBytes.length || domainBytes[i] == ".") {
                if (i > start) {
                    bytes memory part = new bytes(i - start);
                    for (uint256 j = start; j < i; ++j) {
                        part[j - start] = domainBytes[j];
                    }
                    parts[partIndex] = string(part);
                    ++partIndex;
                }
                start = i + 1;
            }
        }

        return parts;
    }

    /// @notice Builds a node hash from domain parts
    function _buildNodeFromParts(string[] memory domainParts) internal view returns (bytes32) {
        bytes32 node = registry.baseNode();

        for (uint256 i = domainParts.length; i > 0; i--) {
            node = registry.makeNode(node, domainParts[i - 1]);
        }

        return node;
    }

    /// @notice Checks if a node is available for registration
    function _isNodeAvailable(bytes32 node) internal view returns (bool) {
        uint256 tokenId = uint256(node);

        try registry.ownerOf(tokenId) {
            return false;
        } catch {
            return true;
        }
    }

    /// @notice Checks if a given domain is available for registration
    /// @param fullDomain The full domain to check (e.g. "bob.github.io")
    /// @return available True if the domain can be registered, false if already taken
    function available(string calldata fullDomain) external view returns (bool) {
        string[] memory domainParts = _parseDomain(fullDomain);
        if (domainParts.length == 0) return false;

        bytes32 finalNode = _buildNodeFromParts(domainParts);
        return _isNodeAvailable(finalNode);
    }

    /// @notice Transfers ownership of a registered domain
    function transferDomain(string calldata fullDomain, address newOwner) external {
        require(newOwner != address(0), Registrar__InvalidAddress());

        string[] memory domainParts = _parseDomain(fullDomain);
        bytes32 node = _buildNodeFromParts(domainParts);

        Registration storage reg = registrations[node];
        require(reg.owner == msg.sender, Registrar__NotOwner());

        registry.transferFrom(msg.sender, newOwner, uint256(node));

        reg.owner = newOwner;
    }

    /// @notice Gets registration information for a domain
    function getRegistration(string calldata fullDomain)
        external
        view
        returns (address owner, uint256 registrationTime, bool verified)
    {
        string[] memory domainParts = _parseDomain(fullDomain);
        bytes32 node = _buildNodeFromParts(domainParts);

        Registration memory reg = registrations[node];
        return (reg.owner, reg.registrationTime, reg.verified);
    }

    /// @notice Updates Chainlink Functions configuration
    function updateChainlinkConfig(bytes32 _donId, uint64 _subscriptionId, uint32 _gasLimit) external onlyOwner {
        donId = _donId;
        subscriptionId = _subscriptionId;
        gasLimit = _gasLimit;
    }

    /// @inheritdoc IERC721Receiver
    function onERC721Received(address, address, uint256, bytes memory) public override returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
