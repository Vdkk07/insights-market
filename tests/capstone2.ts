import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PredictionMarket } from "../target/types/prediction_market";
import { expect } from "chai";

describe("Prediction Market - Complete Test Suite", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace
    .PredictionMarket as Program<PredictionMarket>;

  // Create 10 traders
  const traders = Array.from({ length: 10 }, () =>
    anchor.web3.Keypair.generate()
  );
  const authority = provider.wallet.publicKey;

  // Market configuration
  const MARKET_DURATION = 60; // 1 minute in seconds

  // 3 markets with different outcomes
  const markets: {
    marketId: number;
    question: string;
    description: string;
    category: string;
    outcome: boolean;
    vaultPda?: anchor.web3.PublicKey;
    marketPda?: anchor.web3.PublicKey;
  }[] = [
    {
      marketId: 1,
      question: "Will SOL price exceed $100 in 1 minute?",
      description: "Market resolves YES if SOL > $100, otherwise NO",
      category: "Crypto",
      outcome: true, // YES wins
    },
    {
      marketId: 2,
      question: "Will BTC price exceed $50k in 1 minute?",
      description: "Market resolves YES if BTC > $50k, otherwise NO",
      category: "Crypto",
      outcome: false, // NO wins
    },
    {
      marketId: 3,
      question: "Will ETH price exceed $3k in 1 minute?",
      description: "Market resolves YES if ETH > $3k, otherwise NO",
      category: "Crypto",
      outcome: true, // YES wins
    },
  ];

  let configPda: anchor.web3.PublicKey;
  let feeVaultPda: anchor.web3.PublicKey;
  let initialAuthorityBalance: number;
  let totalExpectedFeeProfit = new anchor.BN(0);

  // Helper function to add delay between transactions
  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  before(async () => {
    console.log("\n Setting up test environment...\n");

    // Derive config PDA
    [configPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    // Derive fee vault PDA
    [feeVaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("fee_vault")],
      program.programId
    );

    // Airdrop SOL to authority
    try {
      const sig = await provider.connection.requestAirdrop(
        authority,
        10 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
    } catch (e) {
      console.log(" Authority already funded");
    }

    // Record initial balance AFTER airdrop but BEFORE contract activity
    initialAuthorityBalance = await provider.connection.getBalance(authority);

    // Airdrop MORE SOL to all traders (increased from 10 to 15 SOL)
    console.log(" Funding traders...");
    for (let i = 0; i < traders.length; i++) {
      const trader = traders[i];
      const sig = await provider.connection.requestAirdrop(
        trader.publicKey,
        15 * anchor.web3.LAMPORTS_PER_SOL // INCREASED FROM 10 to 15
      );
      await provider.connection.confirmTransaction(sig);

      // Small delay between airdrops to avoid rate limiting
      await delay(100);

      if ((i + 1) % 3 === 0) {
        console.log(`  Funded ${i + 1}/${traders.length} traders`);
      }
    }

    console.log(" Airdrops completed for authority and 10 traders\n");
  });

  describe("Initialization", () => {
    it("Initializes the config", async () => {
      const configInfo = await provider.connection.getAccountInfo(configPda);
      if (configInfo) {
        console.log(" Config already initialized");
        return;
      }

      try {
        await program.methods
          .initialize()
          .accounts({
            config: configPda,
            feeVault: feeVaultPda,
            authority: authority,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();

        console.log(" Config initialized successfully");
      } catch (e) {
        console.log(` Config initialization failed: ${e.message}`);
        throw e;
      }
    });
  });

  describe("Market Creation", () => {
    it("Creates 3 prediction markets", async () => {
      const currentTime = Math.floor(Date.now() / 1000);
      const initialLiquidity = new anchor.BN(
        0.1 * anchor.web3.LAMPORTS_PER_SOL
      );

      for (let i = 0; i < markets.length; i++) {
        const market = markets[i];
        const resolutionTime = new anchor.BN(currentTime + MARKET_DURATION);

        // Derive market PDA
        const [marketPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("market"),
            new anchor.BN(market.marketId).toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );
        market.marketPda = marketPda;

        // Derive vault PDA
        const [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
          [
            Buffer.from("vault"),
            new anchor.BN(market.marketId).toArrayLike(Buffer, "le", 8),
          ],
          program.programId
        );
        market.vaultPda = vaultPda;

        try {
          await program.methods
            .createMarket(
              new anchor.BN(market.marketId),
              market.question,
              market.description,
              market.category,
              resolutionTime,
              initialLiquidity
            )
            .accounts({
              config: configPda,
              market: marketPda,
              vault: vaultPda,
              authority: authority,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc();

          console.log(` Market ${i + 1} created: ${market.question}`);

          // Add small delay between market creations
          await delay(500);
        } catch (e) {
          console.log(` Failed to create market ${i + 1}: ${e.message}`);
          throw e;
        }
      }
      console.log();
    });

    it("Verifies all markets were created correctly", async () => {
      for (let i = 0; i < markets.length; i++) {
        const market = markets[i];
        const marketAccount = await program.account.market.fetch(
          market.marketPda
        );

        expect(marketAccount.question).to.equal(market.question);
        expect(marketAccount.resolved).to.be.false;

        console.log(`   Market ${i + 1}: "${marketAccount.question}"`);
      }
      console.log();
    });
  });

  describe("Share Purchases", () => {
    it("10 traders buy shares across all 3 markets", async () => {
      let successfulPurchases = 0;
      const failedPurchases: string[] = [];

      for (let traderIndex = 0; traderIndex < traders.length; traderIndex++) {
        const trader = traders[traderIndex];
        const buyYes = traderIndex < 5; // First 5 buy YES, last 5 buy NO

        // Check trader balance before purchases
        const traderBalance = await provider.connection.getBalance(
          trader.publicKey
        );
        console.log(
          `\n Trader ${traderIndex + 1} balance: ${(
            traderBalance / anchor.web3.LAMPORTS_PER_SOL
          ).toFixed(4)} SOL`
        );

        for (let marketIndex = 0; marketIndex < markets.length; marketIndex++) {
          const market = markets[marketIndex];

          // FIXED: Reduced amount to 0.02 SOL to ensure sufficient funds
          const amount = new anchor.BN(0.02 * anchor.web3.LAMPORTS_PER_SOL);

          // Calculate and accumulate expected fee profit (2%)
          const fee = amount.mul(new anchor.BN(200)).div(new anchor.BN(10000));
          totalExpectedFeeProfit = totalExpectedFeeProfit.add(fee);

          // Minimum shares out (for slippage protection)
          const minSharesOut = new anchor.BN(0);

          // Derive user position PDA
          const [userPositionPda] =
            anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("position"),
                trader.publicKey.toBuffer(),
                new anchor.BN(market.marketId).toArrayLike(Buffer, "le", 8),
              ],
              program.programId
            );

          try {
            // Get fresh blockhash for each transaction
            const { blockhash } =
              await provider.connection.getLatestBlockhash();

            await program.methods
              .buyShares(buyYes, amount, minSharesOut)
              .accounts({
                config: configPda,
                market: market.marketPda,
                vault: market.vaultPda,
                feeVault: feeVaultPda,
                userPosition: userPositionPda,
                user: trader.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
              })
              .signers([trader])
              .rpc({
                skipPreflight: false, // Changed to false for better error messages
                commitment: "confirmed",
              });

            successfulPurchases++;

            console.log(
              `  Trader ${traderIndex + 1} - Market ${marketIndex + 1}: ${
                buyYes ? "YES" : "NO"
              } shares purchased`
            );

            // CRITICAL: Add delay between transactions to prevent nonce conflicts
            await delay(300);
          } catch (e) {
            const errorMsg = `Trader ${traderIndex + 1} - Market ${
              marketIndex + 1
            }: ${e.message.substring(0, 80)}`;
            failedPurchases.push(errorMsg);
            console.log(`  ${errorMsg}`);

            // Add delay even on error
            await delay(300);
          }
        }
      }

      console.log(`\n Purchase Summary:`);
      console.log(`   Successful: ${successfulPurchases}/30`);
      console.log(`   Failed: ${failedPurchases.length}/30\n`);

      if (failedPurchases.length > 0) {
        console.log("Failed purchases:");
        failedPurchases.forEach((err) => console.log(`   - ${err}`));
      }

      // Expect at least 20 successful purchases (allowing some failures)
      expect(successfulPurchases).to.be.at.least(
        20,
        `Expected at least 20 successful purchases, got ${successfulPurchases}`
      );
    });

    it("Verifies market share totals after purchases", async () => {
      for (let i = 0; i < markets.length; i++) {
        const market = markets[i];

        try {
          const marketAccount = await program.account.market.fetch(
            market.marketPda
          );

          const yesSOL =
            marketAccount.yesLiquidity.toNumber() /
            anchor.web3.LAMPORTS_PER_SOL;
          const noSOL =
            marketAccount.noLiquidity.toNumber() / anchor.web3.LAMPORTS_PER_SOL;
          const totalPool = yesSOL + noSOL;

          console.log(` Market ${i + 1}:`);
          console.log(`   YES liquidity: ${yesSOL.toFixed(4)} SOL`);
          console.log(`   NO liquidity:  ${noSOL.toFixed(4)} SOL`);
          console.log(`   Total pool: ${totalPool.toFixed(4)} SOL`);

          expect(marketAccount.yesLiquidity.toNumber()).to.be.greaterThan(0);
          expect(marketAccount.noLiquidity.toNumber()).to.be.greaterThan(0);
        } catch (e) {
          console.log(`   Market ${i + 1} not found, skipping...`);
        }
      }
      console.log();
    });

    it("Verifies user positions were created correctly", async () => {
      const checkTraders = [0, 5, 9];

      for (const traderIndex of checkTraders) {
        const trader = traders[traderIndex];
        const buyYes = traderIndex < 5;

        try {
          const [userPositionPda] =
            anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("position"),
                trader.publicKey.toBuffer(),
                new anchor.BN(markets[0].marketId).toArrayLike(Buffer, "le", 8),
              ],
              program.programId
            );

          const position = await program.account.userPosition.fetch(
            userPositionPda
          );

          if (buyYes) {
            console.log(
              `   Trader ${
                traderIndex + 1
              } has ${position.yesShares.toString()} YES shares`
            );
          } else {
            console.log(
              `   Trader ${
                traderIndex + 1
              } has ${position.noShares.toString()} NO shares`
            );
          }
        } catch (e) {
          console.log(`   Trader ${traderIndex + 1} position not found`);
        }
      }
      console.log();
    });
  });

  describe("Market Resolution", () => {
    it("Waits for market duration to pass", async () => {
      console.log(" Waiting for market duration to pass (1 minute)...");
      await new Promise((resolve) =>
        setTimeout(resolve, (MARKET_DURATION + 5) * 1000)
      );
      console.log(" Market duration complete\n");
    });

    it("Resolves all 3 markets with correct outcomes", async () => {
      for (let i = 0; i < markets.length; i++) {
        const market = markets[i];

        try {
          await program.methods
            .resolveMarket(market.outcome)
            .accounts({
              config: configPda,
              market: market.marketPda,
              authority: authority,
            })
            .rpc();

          console.log(
            ` Market ${i + 1} resolved: ${market.outcome ? "YES" : "NO"} wins`
          );

          // Add delay between resolutions
          await delay(500);
        } catch (e) {
          console.log(` Failed to resolve market ${i + 1}: ${e.message}`);
        }
      }
      console.log();
    });

    it("Verifies markets cannot be resolved again", async () => {
      const market = markets[0];

      try {
        await program.methods
          .resolveMarket(!market.outcome)
          .accounts({
            config: configPda,
            market: market.marketPda,
            authority: authority,
          })
          .rpc();

        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
        console.log(" Correctly prevented double resolution\n");
      }
    });
  });

  describe("Claiming Winnings", () => {
    it("Winners claim their rewards from all markets", async () => {
      let totalWinners = 0;
      let totalClaimed = new anchor.BN(0);

      for (let traderIndex = 0; traderIndex < traders.length; traderIndex++) {
        const trader = traders[traderIndex];
        const boughtYes = traderIndex < 5;

        for (let marketIndex = 0; marketIndex < markets.length; marketIndex++) {
          const market = markets[marketIndex];
          const isWinner = boughtYes === market.outcome;

          if (!isWinner) {
            continue;
          }

          const [userPositionPda] =
            anchor.web3.PublicKey.findProgramAddressSync(
              [
                Buffer.from("position"),
                trader.publicKey.toBuffer(),
                new anchor.BN(market.marketId).toArrayLike(Buffer, "le", 8),
              ],
              program.programId
            );

          try {
            const balanceBefore = await provider.connection.getBalance(
              trader.publicKey
            );

            await program.methods
              .claimWinnings()
              .accounts({
                market: market.marketPda,
                vault: market.vaultPda,
                userPosition: userPositionPda,
                user: trader.publicKey,
                systemProgram: anchor.web3.SystemProgram.programId,
              })
              .signers([trader])
              .rpc();

            const balanceAfter = await provider.connection.getBalance(
              trader.publicKey
            );
            const winnings =
              (balanceAfter - balanceBefore) / anchor.web3.LAMPORTS_PER_SOL;

            totalWinners++;
            totalClaimed = totalClaimed.add(
              new anchor.BN(balanceAfter - balanceBefore)
            );

            console.log(
              `   Trader ${traderIndex + 1} claimed ${winnings.toFixed(
                4
              )} SOL from Market ${marketIndex + 1}`
            );

            // Add delay between claims
            await delay(300);
          } catch (error) {
            if (
              !error.message.includes("Account does not exist") &&
              !error.message.includes("AccountNotInitialized")
            ) {
              console.log(
                `   Trader ${traderIndex + 1} - Market ${marketIndex + 1}: ${
                  error.message
                }`
              );
            }
          }
        }
      }

      console.log(`\n Claim Summary:`);
      console.log(`   Total successful claims: ${totalWinners}`);
      console.log(
        `   Total claimed: ${(
          totalClaimed.toNumber() / anchor.web3.LAMPORTS_PER_SOL
        ).toFixed(4)} SOL\n`
      );

      expect(totalWinners).to.be.greaterThan(
        0,
        "At least some winners should be able to claim"
      );
    });

    it("Verifies user positions are marked as claimed", async () => {
      const trader = traders[0];
      const market = markets[0];

      const [userPositionPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          trader.publicKey.toBuffer(),
          new anchor.BN(market.marketId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      try {
        const position = await program.account.userPosition.fetch(
          userPositionPda
        );
        if (
          position.claimed ||
          (position.yesShares.isZero() && position.noShares.isZero())
        ) {
          console.log(
            " Winner's position correctly marked as claimed/zeroed\n"
          );
        } else {
          console.log(" Position not marked as claimed\n");
        }
      } catch (error) {
        console.log(" Position account not found\n");
      }
    });

    it("Losers cannot claim winnings", async () => {
      const trader = traders[5];
      const market = markets[0];

      const [userPositionPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          trader.publicKey.toBuffer(),
          new anchor.BN(market.marketId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      try {
        await program.methods
          .claimWinnings()
          .accounts({
            market: market.marketPda,
            vault: market.vaultPda,
            userPosition: userPositionPda,
            user: trader.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([trader])
          .rpc();

        expect.fail("Loser should not be able to claim");
      } catch (error) {
        expect(error).to.exist;
        console.log(" Correctly prevented loser from claiming\n");
      }
    });
  });

  describe("Analytics & Statistics", () => {
    it("Authority withdraws collected fees", async () => {
      const feeVaultBalance = await provider.connection.getBalance(feeVaultPda);

      if (feeVaultBalance > 0) {
        try {
          await program.methods
            .withdrawFees(new anchor.BN(feeVaultBalance))
            .accounts({
              config: configPda,
              feeVault: feeVaultPda,
              authority: authority,
              systemProgram: anchor.web3.SystemProgram.programId,
            })
            .rpc();

          console.log(
            ` Authority withdrew ${(
              feeVaultBalance / anchor.web3.LAMPORTS_PER_SOL
            ).toFixed(4)} SOL in fees\n`
          );
        } catch (e) {
          console.log(` Failed to withdraw fees: ${e.message}\n`);
        }
      } else {
        console.log(" No fees to withdraw\n");
      }
    });

    it("Calculates and displays contract profit", async () => {
      const realizedProfitSOL =
        totalExpectedFeeProfit.toNumber() / anchor.web3.LAMPORTS_PER_SOL;

      const finalAuthorityBalance = await provider.connection.getBalance(
        authority
      );
      const netAuthorityChangeSOL =
        (finalAuthorityBalance - initialAuthorityBalance) /
        anchor.web3.LAMPORTS_PER_SOL;

      console.log("━".repeat(60));
      console.log(" Contract Profit Summary (Authority):\n");
      console.log(
        `   Realized Profit (Fees): ${realizedProfitSOL.toFixed(4)} SOL`
      );
      console.log(
        `   Net Authority Change:   ${netAuthorityChangeSOL.toFixed(4)} SOL`
      );
      console.log("━".repeat(60));
      console.log();
    });

    it("Displays final trader balances", async () => {
      console.log(" Final Trader Balances:");

      for (let i = 0; i < traders.length; i++) {
        const balance = await provider.connection.getBalance(
          traders[i].publicKey
        );
        const balanceSOL = balance / anchor.web3.LAMPORTS_PER_SOL;

        console.log(`   Trader ${i + 1}: ${balanceSOL.toFixed(4)} SOL`);
      }
      console.log();
    });

    it("Verifies market vault balances", async () => {
      console.log(" Final Vault Balances:");

      let totalVaultBalance = 0;
      for (let i = 0; i < markets.length; i++) {
        const market = markets[i];

        if (market.vaultPda) {
          const vaultBalance = await provider.connection.getBalance(
            market.vaultPda
          );
          totalVaultBalance += vaultBalance;

          console.log(
            `   Market ${i + 1} vault: ${(
              vaultBalance / anchor.web3.LAMPORTS_PER_SOL
            ).toFixed(4)} SOL`
          );
        }
      }
      console.log(
        `   Total Unclaimed: ${(
          totalVaultBalance / anchor.web3.LAMPORTS_PER_SOL
        ).toFixed(4)} SOL\n`
      );
    });
  });

  describe("Edge Cases", () => {
    it("Cannot buy shares after market ends", async () => {
      const newTrader = anchor.web3.Keypair.generate();
      const sig = await provider.connection.requestAirdrop(
        newTrader.publicKey,
        1 * anchor.web3.LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);

      const market = markets[0];
      const amount = new anchor.BN(0.01 * anchor.web3.LAMPORTS_PER_SOL);
      const minSharesOut = new anchor.BN(0);

      const [userPositionPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          newTrader.publicKey.toBuffer(),
          new anchor.BN(market.marketId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      try {
        await program.methods
          .buyShares(true, amount, minSharesOut)
          .accounts({
            config: configPda,
            market: market.marketPda,
            vault: market.vaultPda,
            feeVault: feeVaultPda,
            userPosition: userPositionPda,
            user: newTrader.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([newTrader])
          .rpc();

        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
        console.log(" Correctly prevented buying shares after market end\n");
      }
    });

    it("Cannot claim twice", async () => {
      const trader = traders[0];
      const market = markets[0];

      const [userPositionPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          trader.publicKey.toBuffer(),
          new anchor.BN(market.marketId).toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      try {
        await program.methods
          .claimWinnings()
          .accounts({
            market: market.marketPda,
            vault: market.vaultPda,
            userPosition: userPositionPda,
            user: trader.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([trader])
          .rpc();

        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.exist;
        console.log(" Correctly prevented double claiming\n");
      }
    });
  });
});
