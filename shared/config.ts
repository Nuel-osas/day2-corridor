// Every address here was checked on 8 November 2026. How each was verified is noted beside it.
import deployment from './deployment.json' with { type: 'json' };

export const IRIS = 'https://iris-api-sandbox.circle.com'; // Circle attestation service, testnet

// Sui testnet, CCTP V2. Source: developers.circle.com/cctp/references/sui-packages, then confirmed
// with GraphQL (each object exists, the state objects have these types) and by reading live burns
// (e.g. 3WFvh6z9...hQxL) and mints (DHwH3heo...yad) that use exactly these ids.
export const SUI = {
	network: 'testnet' as const,
	grpc: 'https://fullnode.testnet.sui.io:443',
	graphql: 'https://graphql.testnet.sui.io/graphql',
	explorer: 'https://suiscan.xyz/testnet',
	domain: 8,
	usdc: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
	usdcDecimals: 6,
	messageTransmitter: {
		pkg: '0xe9678cd42a81886e18e21361088071f275105636a4d3751e1d7f255211f73bbe',
		state: '0xfee3a2b47f9ef2de2405fc63d79194307945f8ea768815cfc46083bc20fbe6ed',
	},
	tokenMessengerMinter: {
		pkg: '0x267d3c0cb776eace2840f27e4d33da9c6d952f9749403f1fe6579f4962ed3c64',
		state: '0x72cb55cd14d01e6361386d6ea93eecda9fa1efc3c202b8dd69c1e4683e4c0ca0',
	},
	stablecoinHandler: {
		pkg: '0xbe8479044396a45e07de2c7f14789c35b8338406eebc53b2527da56839a91561',
		state: '0xfbd9c0517c4f0e1817445ee2be598806e3c392a465d7e3d773d1055f3f0eed32',
	},
	usdcTreasury: '0x7170137d4a6431bf83351ac025baf462909bffe2877d87716374fb42b9629ebe',
	denyList: '0x403',
	clock: '0x6',
};

// Base Sepolia, CCTP V2. Source: developers.circle.com/cctp/references/contract-addresses (same
// addresses on every EVM testnet); eth_getCode returns bytecode at each. The token messenger
// matches destination_token_messenger in live Sui burns to domain 6.
export const BASE_SEPOLIA = {
	name: 'Base Sepolia',
	domain: 6,
	chainId: 84532,
	explorer: 'https://sepolia.basescan.org',
	usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
	tokenMessenger: '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA',
	messageTransmitter: '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275',
} as const;

// Corridor itself: published from move/corridor (digest HB5gC9Py...fVab), then opened by
// scripts/open-corridor.ts, which writes shared/deployment.json.
export const CORRIDOR = deployment as {
	pkg: string;
	corridorId: string;
	adminCapId: string;
	operator: string;
	relayerEvm: string;
	openDigest: string;
	feeBps: number;
	minFee: string;
};

// Sui sends only standard transfers (finality 2000). Fast transfers (1000) work into Sui.
export const FINALITY = { fast: 1000, standard: 2000 } as const;
