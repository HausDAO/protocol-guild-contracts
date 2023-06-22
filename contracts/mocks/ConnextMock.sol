// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import { IXReceiver } from "@connext/interfaces/core/IXReceiver.sol";

error BridgeFacet__xcall_nativeAssetNotSupported();
error BridgeFacet__xcall_emptyTo();

contract ConnextMock {

  struct AppStorage {
    uint256 nonce;
    uint32 domain;
  }

  /**
   * @notice Defines the fields needed for an asset transfer
   * @param asset - The address of the asset
   * @param amount - The amount of the asset
   */
  struct AssetTransfer {
    address asset;
    uint256 amount;
  }

  // Tokens are identified by a TokenId:
  // domain - 4 byte chain ID of the chain from which the token originates
  // id - 32 byte identifier of the token address on the origin chain, in that chain's address format
  struct TokenId {
    uint32 domain;
    bytes32 id;
  }

  struct TransferInfo {
    uint32 originDomain;
    uint32 destinationDomain;
    uint32 canonicalDomain;
    address to;
    address delegate;
    bool receiveLocal;
    bytes callData;
    uint256 slippage;
    address originSender;
    uint256 bridgedAmt;
    uint256 normalizedIn;
    uint256 nonce;
    bytes32 canonicalId;
  }

  AppStorage internal s;

  /**
   * @notice Emitted when `xcall` is called on the origin domain of a transfer.
   * @param transferId - The unique identifier of the crosschain transfer.
   * @param nonce - The bridge nonce of the transfer on the origin domain.
   * @param messageHash - The hash of the message bytes (containing all transfer info) that were bridged.
   * @param params - The `TransferInfo` provided to the function.
   * @param asset - The asset sent in with xcall
   * @param amount - The amount sent in with xcall
   * @param local - The local asset that is controlled by the bridge and can be burned/minted
   */
  event XCalled(
    bytes32 indexed transferId,
    uint256 indexed nonce,
    bytes32 indexed messageHash,
    TransferInfo params,
    address asset,
    uint256 amount,
    address local,
    bytes messageBody
  );

  constructor(uint32 _domain) {
    s.domain = _domain;
  }

  /**
   * @notice Calculates a transferId
   */
  function _calculateTransferId(TransferInfo memory _params) internal pure returns (bytes32) {
    return keccak256(abi.encode(_params));
  }

  function xcall(
    uint32 _destination,
    address _to,
    address _asset,
    address _delegate,
    uint256 _amount,
    uint256 _slippage,
    bytes calldata _callData /*nonXCallReentrant*/
  ) external payable returns (bytes32) {
    // NOTE: Here, we fill in as much information as we can for the TransferInfo.
    // Some info is left blank and will be assigned in the internal `_xcall` function (e.g.
    // `normalizedIn`, `bridgedAmt`, canonical info, etc).
    TransferInfo memory params = TransferInfo({
        to: _to,
        callData: _callData,
        originDomain: s.domain,
        destinationDomain: _destination,
        delegate: _delegate,
        // `receiveLocal: false` indicates we should always deliver the adopted asset on the
        // destination chain, swapping from the local asset if needed.
        receiveLocal: false,
        slippage: _slippage,
        originSender: msg.sender,
        // The following values should be assigned in _xcall.
        nonce: 0,
        canonicalDomain: 0,
        bridgedAmt: 0,
        normalizedIn: 0,
        canonicalId: bytes32(0)
    });

    return _xcall(params, AssetTransfer(_asset, _amount), AssetTransfer(_asset, msg.value));
  }

  /**
   * @notice Initiates a cross-chain transfer of funds and/or calldata
   *
   * @dev For ERC20 transfers, this contract must have approval to transfer the input (transacting) assets. The adopted
   * assets will be swapped for their local asset counterparts (i.e. bridgeable tokens) via the configured AMM if
   * necessary. In the event that the adopted assets *are* local bridge assets, no swap is needed. The local tokens will
   * then be sent via the bridge router. If the local assets are representational for an asset on another chain, we will
   * burn the tokens here. If the local assets are canonical (meaning that the adopted<>local asset pairing is native
   * to this chain), we will custody the tokens here.
   *
   * @param _params - The TransferInfo arguments.
   * @return bytes32 - The transfer ID of the newly created crosschain transfer.
   */
  function _xcall(
    TransferInfo memory _params,
    AssetTransfer memory _asset,
    AssetTransfer memory _relayer
  )
    internal
    // whenNotPaused
    returns (bytes32)
  {
    // Sanity checks.
    bytes32 remoteInstance = bytes32(uint256(uint160(address(this))));
    {
        // Not native asset.
        // NOTE: We support using address(0) as an intuitive default if you are sending a 0-value
        // transfer. In that edge case, address(0) will not be registered as a supported asset, but should
        // pass the `isLocalOrigin` check
        if (_asset.asset == address(0) && _asset.amount != 0) {
            revert BridgeFacet__xcall_nativeAssetNotSupported();
        }

        // Destination domain is supported.
        // NOTE: This check implicitly also checks that `_params.destinationDomain != s.domain`, because the index
        // `s.domain` of `s.remotes` should always be `bytes32(0)`.
        // remoteInstance = _mustHaveRemote(_params.destinationDomain);

        // Recipient defined.
        if (_params.to == address(0)) {
            revert BridgeFacet__xcall_emptyTo();
        }

        // if (_params.slippage > Constants.BPS_FEE_DENOMINATOR) {
        //     revert BridgeFacet__xcall_invalidSlippage();
        // }
    }

    // NOTE: The local asset will stay address(0) if input asset is address(0) in the event of a
    // 0-value transfer. Otherwise, the local address will be retrieved below
    address local;
    bytes32 transferId;
    TokenId memory canonical;
    bool isCanonical;
    // {
    //     // Check that the asset is supported -- can be either adopted or local.
    //     // NOTE: Above we check that you can only have `address(0)` as the input asset if this is a
    //     // 0-value transfer. Because 0-value transfers short-circuit all checks on mappings keyed on
    //     // hash(canonicalId, canonicalDomain), this is safe even when the address(0) asset is not
    //     // allowlisted.
    //     if (_asset.asset != address(0)) {
    //         // Retrieve the canonical token information.
    //         bytes32 key;
    //         (canonical, key) = _getApprovedCanonicalId(_asset.asset);

    //         // Get the token config.
    //         TokenConfig storage config = AssetLogic.getConfig(key);

    //         // Set boolean flag
    //         isCanonical = _params.originDomain == canonical.domain;

    //         // Get the local address
    //         local = isCanonical ? TypeCasts.bytes32ToAddress(canonical.id) : config.representation;
    //         if (local == address(0)) {
    //             revert BridgeFacet_xcall__emptyLocalAsset();
    //         }

    //         {
    //             // Enforce liquidity caps.
    //             // NOTE: Safe to do this before the swap because canonical domains do
    //             // not hit the AMMs (local == canonical).
    //             uint256 cap = config.cap;
    //             if (isCanonical && cap > 0) {
    //                 // NOTE: this method includes router liquidity as part of the caps,
    //                 // not only the minted amount
    //                 uint256 newCustodiedAmount = config.custodied + _asset.amount;
    //                 if (newCustodiedAmount > cap) {
    //                     revert BridgeFacet__xcall_capReached();
    //                 }
    //                 s.tokenConfigs[key].custodied = newCustodiedAmount;
    //             }
    //         }

    //         // Update TransferInfo to reflect the canonical token information.
    //         _params.canonicalDomain = canonical.domain;
    //         _params.canonicalId = canonical.id;

    //         if (_asset.amount > 0) {
    //             // Transfer funds of input asset to the contract from the user.
    //             AssetLogic.handleIncomingAsset(_asset.asset, _asset.amount);

    //             // Swap to the local asset from adopted if applicable.
    //             _params.bridgedAmt = AssetLogic.swapToLocalAssetIfNeeded(
    //                 key,
    //                 _asset.asset,
    //                 local,
    //                 _asset.amount,
    //                 _params.slippage
    //             );

    //             // Get the normalized amount in (amount sent in by user in 18 decimals).
    //             // NOTE: when getting the decimals from `_asset`, you don't know if you are looking for
    //             // adopted or local assets
    //             _params.normalizedIn = AssetLogic.normalizeDecimals(
    //                 _asset.asset == local ? config.representationDecimals : config.adoptedDecimals,
    //                 Constants.DEFAULT_NORMALIZED_DECIMALS,
    //                 _asset.amount
    //             );
    //         }
    //     }

    //     // Calculate the transfer ID.
    //     _params.nonce = s.nonce++;
    //     transferId = _calculateTransferId(_params);
    // }
    _params.nonce = s.nonce++;
    transferId = _calculateTransferId(_params);

    // Handle the relayer fee.
    // NOTE: This has to be done *after* transferring in + swapping assets because
    // the transfer id uses the amount that is bridged (i.e. amount in local asset).
    if (_relayer.amount > 0) {
        // _bumpTransfer(transferId, _relayer.asset, _relayer.amount);
        // return funds to sender
        (bool success,) = msg.sender.call{value: _relayer.amount}("");
        if (!success) {
          // TODO:
        }
    }

    // Send the crosschain message.
    _sendMessageAndEmit(
        transferId,
        _params,
        _asset.asset,
        _asset.amount,
        remoteInstance,
        canonical,
        local,
        isCanonical
    );

    return transferId;
  }

  /**
   * @notice Format and send transfer message to a remote chain.
   *
   * @param _transferId Unique identifier for the transfer.
   * @param _params The TransferInfo.
   * @param _local The local token address.
   * @param _amount The token amount.
   * "home" chain).
   */
  function _sendMessageAndEmit(
    bytes32 _transferId,
    TransferInfo memory _params,
    address _asset,
    uint256 _amount,
    bytes32 /*_connextion*/,
    TokenId memory /*_canonical*/,
    address _local,
    bool /*_isCanonical*/
  ) private {
    // Remove tokens from circulation on this chain if applicable.
    // uint256 bridgedAmt = _params.bridgedAmt;
    // if (bridgedAmt > 0) {
    //   if (!_isCanonical) {
    //     // If the token originates on a remote chain, burn the representational tokens on this chain.
    //     IBridgeToken(_local).burn(address(this), bridgedAmt);
    //   }
    //   // IFF the token IS the canonical token (i.e. originates on this chain), we lock the input tokens in escrow
    //   // in this contract, as an equal amount of representational assets will be minted on the destination chain.
    //   // NOTE: The tokens should be in the contract already at this point from xcall.
    // }

    // bytes memory _messageBody = abi.encodePacked(
    //   _canonical.domain,
    //   _canonical.id,
    //   BridgeMessage.Types.Transfer,
    //   bridgedAmt,
    //   _transferId
    // );
    
    // uint32 originDomain;
    // uint32 destinationDomain;
    // uint32 canonicalDomain;
    // address to;
    // address delegate;
    // bool receiveLocal;
    // bytes callData;
    // uint256 slippage;
    // address originSender;
    // uint256 bridgedAmt;
    // uint256 normalizedIn;
    // uint256 nonce;
    // bytes32 canonicalId;

    // Send message to destination chain bridge router.
    // return message hash and unhashed body
    // (bytes32 messageHash, bytes memory messageBody) = IOutbox(s.xAppConnectionManager.home()).dispatch(
    //   _params.destinationDomain,
    //   _connextion,
    //   _messageBody
    // );
    bytes memory messageBody = abi.encodePacked(
      _transferId,
      _amount,
      _asset,
      _params.originSender,
      _params.originDomain,
      _params.callData
    );
    bytes32 messageHash = keccak256(messageBody);

    IXReceiver(_params.to).xReceive(
      _transferId,
      _amount,
      _asset,
      _params.originSender,
      _params.originDomain,
      _params.callData
    );

    // emit event
    emit XCalled(_transferId, _params.nonce, messageHash, _params, _asset, _amount, _local, messageBody);
  }
}
