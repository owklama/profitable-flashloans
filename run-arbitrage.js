require("dotenv").config();
const Web3 = require("web3");
// Utility interfaces for blockchain interactions
const { ChainId, Token, TokenAmount, Pair } = require("@uniswap/sdk");

const abis = require("./abis");

// Renaming mainnet to address to make it general purpose.
const { mainnet: addresses } = require("./addresses");
const Flashloan = require("./contracts/Flashloan.sol");

// Node provider to interact with the ethereum blockchain,
// Using public node proivders is slow and hackable, other trading bots with a node connection will execute the traders faster,
// and also can front-run you if they catch your arb opportunity of couse.
const web3 = new Web3(
  new Web3.providers.WebsocketProvider(process.env.INFURA_URL)
);

// Renaming the address namepsace provided by web3 wallet connection to admin to make it more interfaceable.
const { address: admin } = web3.eth.accounts.wallet.add(
  process.env.PRIVATE_KEY
);

// Adding kyber networks proxy contract to be able to interact with the the on-chain liquidity provider.
const kyber = new web3.eth.Contract(
  abis.kyber.kyberNetworkProxy,
  addresses.kyber.kyberNetworkProxy
);

// Configuring ONE_WEI as a gas units to make sure the trade is still profiable.
const ONE_WEI = web3.utils.toBN(web3.utils.toWei("1"));
const AMOUNT_DAI_WEI = web3.utils.toBN(web3.utils.toWei("20000"));

// Confifuring the direction of the swap as an obj
const DIRECTION = {
  KYBER_TO_UNISWAP: 0,
  UNISWAP_TO_KYBER: 1,
};

const init = async () => {
  const networkId = await web3.eth.net.getId();
  const flashloan = new web3.eth.Contract(
    Flashloan.abi,
    Flashloan.networks[networkId].address
  );

  // ethPrice represent the current on-chain price of eth
  let ethPrice;

  // Read the eth price from the kyber networks smart contract
  const updateEthPrice = async () => {
    const results = await kyber.methods
      .getExpectedRate(
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        addresses.tokens.dai,
        1
      )
      .call();

    // Format the price of eth and dai
    ethPrice = web3.utils
      .toBN("1")
      .mul(web3.utils.toBN(results.expectedRate))
      .div(ONE_WEI);
  };

  // Updating the pairs price every 15 secs.
  await updateEthPrice();
  setInterval(updateEthPrice, 15000);

  web3.eth
    .subscribe("newBlockHeaders")
    .on("data", async (block) => {
      console.log(`New block received. Block # ${block.number}`);

      const [dai, weth] = await Promise.all(
        [addresses.tokens.dai, addresses.tokens.weth].map((tokenAddress) =>
          Token.fetchData(ChainId.MAINNET, tokenAddress)
        )
      );
      const daiWeth = await Pair.fetchData(dai, weth);

      const amountsEth = await Promise.all([
        kyber.methods
          .getExpectedRate(
            addresses.tokens.dai,
            "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            AMOUNT_DAI_WEI
          )
          .call(),
        daiWeth.getOutputAmount(new TokenAmount(dai, AMOUNT_DAI_WEI)),
      ]);
      const ethFromKyber = AMOUNT_DAI_WEI.mul(
        web3.utils.toBN(amountsEth[0].expectedRate)
      ).div(ONE_WEI);
      const ethFromUniswap = web3.utils.toBN(amountsEth[1][0].raw.toString());

      const amountsDai = await Promise.all([
        kyber.methods
          .getExpectedRate(
            "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            addresses.tokens.dai,
            ethFromUniswap.toString()
          )
          .call(),
        daiWeth.getOutputAmount(new TokenAmount(weth, ethFromKyber.toString())),
      ]);
      const daiFromKyber = ethFromUniswap
        .mul(web3.utils.toBN(amountsDai[0].expectedRate))
        .div(ONE_WEI);
      const daiFromUniswap = web3.utils.toBN(amountsDai[1][0].raw.toString());

      console.log(
        `Kyber -> Uniswap. Dai input / output: ${web3.utils.fromWei(
          AMOUNT_DAI_WEI.toString()
        )} / ${web3.utils.fromWei(daiFromUniswap.toString())}`
      );
      console.log(
        `Uniswap -> Kyber. Dai input / output: ${web3.utils.fromWei(
          AMOUNT_DAI_WEI.toString()
        )} / ${web3.utils.fromWei(daiFromKyber.toString())}`
      );

      if (daiFromUniswap.gt(AMOUNT_DAI_WEI)) {
        const tx = flashloan.methods.initiateFlashloan(
          addresses.dydx.solo,
          addresses.tokens.dai,
          AMOUNT_DAI_WEI,
          DIRECTION.KYBER_TO_UNISWAP
        );
        const [gasPrice, gasCost] = await Promise.all([
          web3.eth.getGasPrice(),
          tx.estimateGas({ from: admin }),
        ]);

        const txCost = web3.utils
          .toBN(gasCost)
          .mul(web3.utils.toBN(gasPrice))
          .mul(ethPrice);
        const profit = daiFromUniswap.sub(AMOUNT_DAI_WEI).sub(txCost);

        if (profit > 0) {
          console.log("Arb opportunity found Kyber -> Uniswap!");
          console.log(`Expected profit: ${web3.utils.fromWei(profit)} Dai`);
          const data = tx.encodeABI();
          const txData = {
            from: admin,
            to: flashloan.options.address,
            data,
            gas: gasCost,
            gasPrice,
          };
          const receipt = await web3.eth.sendTransaction(txData);
          console.log(`Transaction hash: ${receipt.transactionHash}`);
        }
      }

      if (daiFromKyber.gt(AMOUNT_DAI_WEI)) {
        const tx = flashloan.methods.initiateFlashloan(
          addresses.dydx.solo,
          addresses.tokens.dai,
          AMOUNT_DAI_WEI,
          DIRECTION.UNISWAP_TO_KYBER
        );
        const [gasPrice, gasCost] = await Promise.all([
          web3.eth.getGasPrice(),
          tx.estimateGas({ from: admin }),
        ]);
        const txCost = web3.utils
          .toBN(gasCost)
          .mul(web3.utils.toBN(gasPrice))
          .mul(ethPrice);
        const profit = daiFromKyber.sub(AMOUNT_DAI_WEI).sub(txCost);

        if (profit > 0) {
          console.log("Arb opportunity found Uniswap -> Kyber!");
          console.log(`Expected profit: ${web3.utils.fromWei(profit)} Dai`);
          const data = tx.encodeABI();
          const txData = {
            from: admin,
            to: flashloan.options.address,
            data,
            gas: gasCost,
            gasPrice,
          };
          const receipt = await web3.eth.sendTransaction(txData);
          console.log(`Transaction hash: ${receipt.transactionHash}`);
        }
      }
    })
    .on("error", (error) => {
      console.log(error);
    });
};
init();
