// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {Registrar} from "../src/Registrar.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IL2Registry} from "@durin/contracts/interfaces/IL2Registry.sol";

contract RegistrarTest is Test {
    Registrar public registrar;
    address public constant owner = 0x944201F3428E7A0286AEc21dcfEb5E8f79C43E64;
    address public constant registry = 0xE42cfaC25E82e3B77fEfC740a934e11f03957C17;
    address public constant router = 0xC22a79eBA640940ABB6dF0f7982cc119578E11De;
    bytes32 public constant donId = 0x66756e2d706f6c79676f6e2d616d6f792d310000000000000000000000000000;
    address public constant automationRegistry = 0x93C0e201f7B158F503a1265B6942088975f92ce7;
    uint64 public constant subscriptionId = 487;

    function setUp() public {
        registrar = new Registrar(owner, registry, router, donId, subscriptionId, automationRegistry);

        vm.prank(owner);
        IL2Registry(registry).addRegistrar(address(registrar));
    }

    function test_canRequestRegistration() public {
        registrar.requestRegistration("bob.github.io");

        bytes memory response = abi.encode(1);
    }

    function onERC721Received(address, address, uint256, bytes memory) public returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
