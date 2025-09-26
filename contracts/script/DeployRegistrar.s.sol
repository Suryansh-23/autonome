// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Registrar} from "../src/Registrar.sol";
import {Script, console} from "forge-std/Script.sol";
import {IL2Registry} from "@durin/contracts/interfaces/IL2Registry.sol";

contract DeployRegistrar is Script {
    address constant REGISTRY = 0xE42cfaC25E82e3B77fEfC740a934e11f03957C17;
    address constant FUNCTIONS_ROUTER = 0xC22a79eBA640940ABB6dF0f7982cc119578E11De;
    bytes32 constant DON_ID = 0x66756e2d706f6c79676f6e2d616d6f792d310000000000000000000000000000;
    address constant AUTOMATION_REGISTRY = 0x93C0e201f7B158F503a1265B6942088975f92ce7;
    uint64 constant SUBSCRIPTION_ID = 487;

    function run() public {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(privateKey);

        vm.startBroadcast(privateKey);

        Registrar registrar = new Registrar(owner, REGISTRY, FUNCTIONS_ROUTER, DON_ID, SUBSCRIPTION_ID, AUTOMATION_REGISTRY);
        IL2Registry(REGISTRY).addRegistrar(address(registrar));

        //registrar.requestRegistration("express-delta-tawny.vercel.app");

        vm.stopBroadcast();

        console.log("Registrar address: ", address(registrar));
    }
}
