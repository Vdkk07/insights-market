// src/lib/prediction-market-program.ts
import { AnchorProvider, Program, Idl } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import idl from './idl.json'

// This is the program ID you provided
export const PREDICTION_MARKET_PROGRAM_ID = new PublicKey('8M1BMJ2Z9t8239ZsKnY9yF2UAAJEAsGG9wgAFigGZtu8')
// Helper function to get the program
export const getPredictionMarketProgram = (provider: AnchorProvider) => {
  return new Program(idl as Idl, provider)
}
