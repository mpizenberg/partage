/**
 * Proof-of-Work computation module
 *
 * Uses Web Crypto API for SHA-256 hashing to compute PoW solutions.
 * The solution is a nonce that makes SHA256(challenge + nonce) have N leading zero bits.
 */

/**
 * PoW challenge from the server
 */
export interface PoWChallenge {
  challenge: string;
  timestamp: number;
  difficulty: number;
  signature: string;
}

/**
 * PoW solution to submit with requests
 */
export interface PoWSolution {
  pow_challenge: string;
  pow_timestamp: number;
  pow_difficulty: number;
  pow_signature: string;
  pow_solution: string;
}

/**
 * Progress callback for PoW computation
 */
export type PoWProgressCallback = (hashesComputed: number, hashRate: number) => void;

/**
 * Convert a string to Uint8Array using TextEncoder
 */
function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute SHA-256 hash using Web Crypto API
 */
async function sha256(data: string): Promise<string> {
  const bytes = stringToBytes(data);
  // Create a new ArrayBuffer to ensure it's not a SharedArrayBuffer
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Check if a hex hash has at least N leading zero bits
 */
function hasLeadingZeroBits(hexHash: string, requiredBits: number): boolean {
  const fullHexChars = Math.floor(requiredBits / 4);
  const remainingBits = requiredBits % 4;

  // Check full hex characters (must be '0')
  for (let i = 0; i < fullHexChars; i++) {
    if (hexHash[i] !== '0') {
      return false;
    }
  }

  // Check remaining bits in the next hex character
  if (remainingBits > 0 && fullHexChars < hexHash.length) {
    const hexChar = hexHash[fullHexChars];
    if (hexChar === undefined) return false;
    const nextChar = parseInt(hexChar, 16);
    const maxValue = Math.pow(2, 4 - remainingBits);
    if (nextChar >= maxValue) {
      return false;
    }
  }

  return true;
}

/**
 * Compute a PoW solution for a given challenge
 *
 * @param challenge - The challenge from the server
 * @param onProgress - Optional callback for progress updates
 * @param abortSignal - Optional AbortSignal to cancel computation
 * @returns The solution nonce
 */
export async function computePoW(
  challenge: PoWChallenge,
  onProgress?: PoWProgressCallback,
  abortSignal?: AbortSignal
): Promise<string> {
  const { challenge: challengeStr, difficulty } = challenge;

  let nonce = 0;
  let hashesComputed = 0;
  const startTime = Date.now();
  const BATCH_SIZE = 1000; // Check for abort and report progress every N hashes

  while (true) {
    // Check for abort
    if (abortSignal?.aborted) {
      throw new Error('PoW computation aborted');
    }

    // Compute hash
    const input = challengeStr + nonce.toString();
    const hash = await sha256(input);
    hashesComputed++;

    // Check if solution found
    if (hasLeadingZeroBits(hash, difficulty)) {
      return nonce.toString();
    }

    // Report progress periodically
    if (onProgress && hashesComputed % BATCH_SIZE === 0) {
      const elapsedSeconds = (Date.now() - startTime) / 1000;
      const hashRate = Math.round(hashesComputed / elapsedSeconds);
      onProgress(hashesComputed, hashRate);

      // Yield to the event loop to keep UI responsive
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    nonce++;
  }
}

/**
 * Compute PoW using Web Workers for better performance
 * Falls back to main thread if workers not available
 *
 * @param challenge - The challenge from the server
 * @param onProgress - Optional callback for progress updates
 * @param abortSignal - Optional AbortSignal to cancel computation
 * @returns The PoW solution ready to submit
 */
export async function solvePoWChallenge(
  challenge: PoWChallenge,
  onProgress?: PoWProgressCallback,
  abortSignal?: AbortSignal
): Promise<PoWSolution> {
  const solution = await computePoW(challenge, onProgress, abortSignal);

  return {
    pow_challenge: challenge.challenge,
    pow_timestamp: challenge.timestamp,
    pow_difficulty: challenge.difficulty,
    pow_signature: challenge.signature,
    pow_solution: solution,
  };
}

/**
 * Estimate time to solve based on difficulty and hash rate
 *
 * @param difficulty - Number of leading zero bits required
 * @param hashRate - Hashes per second (optional, defaults to estimate)
 * @returns Estimated seconds to solve
 */
export function estimateSolveTime(difficulty: number, hashRate: number = 50000): number {
  // Expected number of hashes to find solution = 2^difficulty
  const expectedHashes = Math.pow(2, difficulty);
  return expectedHashes / hashRate;
}

/**
 * Format duration in human-readable form
 */
export function formatDuration(seconds: number): string {
  if (seconds < 1) {
    return 'less than a second';
  } else if (seconds < 60) {
    return `${Math.round(seconds)} seconds`;
  } else if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else {
    const hours = Math.round(seconds / 3600);
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
}
