// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ENS} from "@ens/contracts/registry/ENS.sol";
import {Resolver} from "@ens/contracts/resolvers/Resolver.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {FunctionsClient} from "@chainlink/contracts/functions/v1_0_0/FunctionsClient.sol";
import {FunctionsRequest} from "@chainlink/contracts/functions/v1_0_0/libraries/FunctionsRequest.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract Registry is Ownable, FunctionsClient {
    ENS public immutable ens;
    address public resolver;
    bytes32 public immutable rootNode; // namehash("x0x0.eth")

    // Supported TLDs
    mapping(string => bool) public supportedTLDs;
    mapping(string => bytes32) public tldNodes; // "com" => namehash("com.x0x0.eth")

    // Registration tracking
    struct Registration {
        address owner;
        string fullDomain; // "hello.com"
        uint256 registrationTime;
        uint256 expirationTime;
        bool verified;
    }

    // subdomain name => TLD => Registration
    mapping(string => mapping(string => Registration)) public registrations;

    // Domain verification tracking
    mapping(string => mapping(string => bool)) public domainVerified;

    // Events
    event SubdomainRegistered(string indexed subdomain, string indexed tld, string fullDomain, address indexed owner);

    event DomainVerified(string fullDomain, address owner);

    uint64 public subscriptionId;
    bytes32 public donId;
    uint32 public gasLimit = 300000;

    string private constant VERIFICATION_SOURCE = 
        "const domain = args[0];\\n" 
        "const address = args[1];\\n" 
        "const response = await Functions.makeHttpRequest({\\n" 
        "  url: `https://${domain}`\\n" 
        "});\\n" 
        "if (response.error) {\\n" 
        "  throw Error('Request failed');\\n" 
        "}\\n" 
        "const html = response.data;\\n" 
        "const headMatch = html.match(/<head[^>]*>([\\s\\S]*?)<\\/head>/i);\\n" 
        "if (!headMatch) {\\n" 
        "  return Functions.encodeBool(false);\\n" 
        "}\\n" 
        "const head = headMatch[1];\\n" 
        "const metaMatch = head.match(/<meta\\s+name=\\\"xoxo-verification\\\"\\s+content=\\\"([^\\\"]+)\\\"/i);\\n" 
        "if (metaMatch && metaMatch[1].toLowerCase() === address.toLowerCase()) {\\n" 
        "  return Functions.encodeBool(true);\\n" 
        "} else {\\n" 
        "  return Functions.encodeBool(false);\\n" 
        "}";
    
    struct PendingRegistration {
        string subdomain;
        string tld;
        string fullDomain;
        address requester;
    }

    mapping(bytes32 => PendingRegistration) public pendingRegistrations;

    error Registry__TLDNotSupported();
    error Registry__EmptySubdomain();
    error Registry__SubdomainTaken();
    error Registry__NotOwner();
    error Registry__Expired();
    error Registry__InvalidAddress();
    error Registry__TLDAlreadySupported();

    constructor(address _initialOwner, ENS _ens, bytes32 _rootNode, address _resolver, string[] memory _tlds, address _functionsRouter, bytes32 _donId, uint64 _subscriptionId)
        Ownable(_initialOwner)
        FunctionsClient(_functionsRouter)
    {
        ens = _ens;
        rootNode = _rootNode;
        resolver = _resolver;
        donId = _donId;
        subscriptionId = _subscriptionId;

        // Initialize supported TLDs
        _initializeTLDs(_tlds);
    }

    function _initializeTLDs(string[] memory _tlds) internal {
        uint256 length = _tlds.length;

        for (uint256 i; i < length; ++i) {
            supportedTLDs[_tlds[i]] = true;

            // Create the TLD subdomain node (e.g., namehash("com.xoxo.eth"))
            bytes32 tldLabel = keccak256(bytes(_tlds[i]));
            bytes32 tldNode = keccak256(abi.encodePacked(rootNode, tldLabel));
            tldNodes[_tlds[i]] = tldNode;

            // Set this contract as owner of TLD subdomains
            ens.setSubnodeOwner(rootNode, tldLabel, address(this));
            ens.setResolver(tldNode, resolver);
        }
    }

    function requestRegistration(
        string memory subdomain,
        string memory tld,
        string memory fullDomain
    ) external {
        if (!supportedTLDs[tld]) revert Registry__TLDNotSupported();
        if (bytes(subdomain).length == 0) revert Registry__EmptySubdomain();
        if (!_isAvailable(subdomain, tld)) revert Registry__SubdomainTaken();

        FunctionsRequest.Request memory req;
        FunctionsRequest.initializeRequest(req, FunctionsRequest.Location.Inline, FunctionsRequest.CodeLanguage.JavaScript, VERIFICATION_SOURCE);

        string[] memory args = new string[](2);
        args[0] = fullDomain;
        args[1] = Strings.toHexString(uint160(msg.sender), 20);
        FunctionsRequest.setArgs(req, args);

        bytes32 requestId = _sendRequest(
            FunctionsRequest.encodeCBOR(req),
            subscriptionId,
            gasLimit,
            donId
        );

        pendingRegistrations[requestId] = PendingRegistration({
            subdomain: subdomain,
            tld: tld,
            fullDomain: fullDomain,
            requester: msg.sender
        });
    }

    function fulfillRequest(
        bytes32 requestId,
        bytes memory response,
        bytes memory err
    ) internal override {
        PendingRegistration memory pending = pendingRegistrations[requestId];
        if (pending.requester == address(0)) {
            return;
        }

        bool verified = false;
        if (err.length == 0 && response.length > 0) {
            verified = abi.decode(response, (bool));
        }

        if (verified) {
            bytes32 subdomainLabel = keccak256(abi.encodePacked(pending.subdomain));
            bytes32 tldNode = tldNodes[pending.tld];
            bytes32 fullNode = keccak256(abi.encodePacked(tldNode, subdomainLabel));

            ens.setSubnodeOwner(tldNode, subdomainLabel, pending.requester);
            ens.setResolver(fullNode, resolver);

            registrations[pending.subdomain][pending.tld] = Registration({
                owner: pending.requester,
                fullDomain: pending.fullDomain,
                registrationTime: block.timestamp,
                expirationTime: block.timestamp + 365 days,
                verified: true
            });

            emit SubdomainRegistered(pending.subdomain, pending.tld, pending.fullDomain, pending.requester);
            emit DomainVerified(pending.fullDomain, pending.requester);
        }

        delete pendingRegistrations[requestId];
    }

    function _isAvailable(string memory subdomain, string memory tld) internal view returns (bool) {
        return registrations[subdomain][tld].owner == address(0)
            || registrations[subdomain][tld].expirationTime < block.timestamp;
    }

    function renewSubdomain(string memory subdomain, string memory tld) external payable {
        Registration storage reg = registrations[subdomain][tld];
        if (reg.owner != msg.sender) revert Registry__NotOwner();
        if (reg.expirationTime <= block.timestamp) revert Registry__Expired();

        reg.expirationTime += 365 days;
    }

    function transferSubdomain(string memory subdomain, string memory tld, address newOwner) external {
        Registration storage reg = registrations[subdomain][tld];
        if (reg.owner != msg.sender) revert Registry__NotOwner();
        if (newOwner == address(0)) revert Registry__InvalidAddress();

        // Update ENS ownership
        bytes32 subdomainLabel = keccak256(bytes(subdomain));
        bytes32 tldNode = tldNodes[tld];
        ens.setSubnodeOwner(tldNode, subdomainLabel, newOwner);

        // Update registration
        reg.owner = newOwner;
    }

    function addSupportedTLD(string memory tld) external onlyOwner {
        if (supportedTLDs[tld]) revert Registry__TLDAlreadySupported();

        supportedTLDs[tld] = true;

        // Create TLD subdomain
        bytes32 tldLabel = keccak256(bytes(tld));
        bytes32 tldNode = keccak256(abi.encodePacked(rootNode, tldLabel));
        tldNodes[tld] = tldNode;

        ens.setSubnodeOwner(rootNode, tldLabel, address(this));
        ens.setResolver(tldNode, resolver);
    }

    function getRegistration(string memory subdomain, string memory tld)
        external
        view
        returns (
            address regOwner,
            string memory fullDomain,
            uint256 registrationTime,
            uint256 expirationTime,
            bool verified
        )
    {
        Registration memory reg = registrations[subdomain][tld];
        return (reg.owner, reg.fullDomain, reg.registrationTime, reg.expirationTime, reg.verified);
    }

    function isAvailable(string memory subdomain, string memory tld) external view returns (bool) {
        return _isAvailable(subdomain, tld);
    }

    // Update Chainlink configuration
    function updateChainlinkConfig(bytes32 _donId, uint64 _subscriptionId, uint32 _gasLimit) external onlyOwner {
        donId = _donId;
        subscriptionId = _subscriptionId;
        gasLimit = _gasLimit;
    }

    function reclaimTLD(string memory tld) external onlyOwner {
        bytes32 tldLabel = keccak256(bytes(tld));
        ens.setSubnodeOwner(rootNode, tldLabel, address(this));
    }

    function setResolver(address newResolver) external onlyOwner {
        resolver = newResolver;
    }

    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
}
