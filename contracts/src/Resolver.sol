// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ResolverBase} from "@ens/contracts/resolvers/ResolverBase.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ENS} from "@ens/contracts/registry/ENS.sol";
import {IAddrResolver} from "@ens/contracts/resolvers/profiles/IAddrResolver.sol";

abstract contract Resolver is ResolverBase, Ownable {
    ENS public immutable ens;

    mapping(bytes32 => address) private addrs;

    constructor(address _initialOwner, ENS _ens) Ownable(_initialOwner) {
        ens = _ens;
    }

    function isAuthorised(bytes32 node) internal view override returns (bool) {
        return msg.sender == ens.owner(node);
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IAddrResolver).interfaceId || super.supportsInterface(interfaceId);
    }

    function addr(bytes32 node) public view returns (address) {
        return addrs[node];
    }

    function setAddr(bytes32 node, address a) external authorised(node) {
        addrs[node] = a;
    }
}
