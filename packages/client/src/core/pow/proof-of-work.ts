/**
 * Proof-of-Work computation module
 *
 * Uses Web Crypto API for SHA-256 hashing to compute PoW solutions.
 * The solution is a nonce that makes SHA256(challenge + nonce) have N leading zero bits.
 *
 * Supports both main-thread and Web Worker computation for better UX.
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
 * Compute a PoW solution for a given challenge (main thread)
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
 * Solve a PoW challenge and return the full solution object
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

// ==================== Web Worker Support ====================

/**
 * Create an inline Web Worker for PoW computation
 * This allows computation to run in a separate thread without blocking the UI
 */
function createPoWWorker(): Worker {
  const workerCode = `
    // Web Worker for PoW computation

    function stringToBytes(str) {
      return new TextEncoder().encode(str);
    }

    function bytesToHex(bytes) {
      return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }

    async function sha256(data) {
      const bytes = stringToBytes(data);
      const buffer = new ArrayBuffer(bytes.length);
      new Uint8Array(buffer).set(bytes);
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      return bytesToHex(new Uint8Array(hashBuffer));
    }

    function hasLeadingZeroBits(hexHash, requiredBits) {
      const fullHexChars = Math.floor(requiredBits / 4);
      const remainingBits = requiredBits % 4;

      for (let i = 0; i < fullHexChars; i++) {
        if (hexHash[i] !== '0') return false;
      }

      if (remainingBits > 0 && fullHexChars < hexHash.length) {
        const nextChar = parseInt(hexHash[fullHexChars], 16);
        const maxValue = Math.pow(2, 4 - remainingBits);
        if (nextChar >= maxValue) return false;
      }

      return true;
    }

    let aborted = false;

    self.onmessage = async function(e) {
      if (e.data.type === 'abort') {
        aborted = true;
        return;
      }

      if (e.data.type === 'solve') {
        const { challengeStr, difficulty } = e.data;
        aborted = false;

        let nonce = 0;
        let hashesComputed = 0;
        const startTime = Date.now();
        const BATCH_SIZE = 1000;
        const PROGRESS_INTERVAL = 5000;

        while (!aborted) {
          const input = challengeStr + nonce.toString();
          const hash = await sha256(input);
          hashesComputed++;

          if (hasLeadingZeroBits(hash, difficulty)) {
            self.postMessage({ type: 'solved', solution: nonce.toString(), hashesComputed });
            return;
          }

          if (hashesComputed % PROGRESS_INTERVAL === 0) {
            const elapsedSeconds = (Date.now() - startTime) / 1000;
            const hashRate = Math.round(hashesComputed / elapsedSeconds);
            self.postMessage({ type: 'progress', hashesComputed, hashRate });
          }

          nonce++;
        }

        self.postMessage({ type: 'aborted' });
      }
    };
  `;

  const blob = new Blob([workerCode], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);
  const worker = new Worker(workerUrl);

  // Clean up blob URL after worker is created
  URL.revokeObjectURL(workerUrl);

  return worker;
}

/**
 * State of background PoW computation
 */
export type PoWState =
  | { status: 'idle' }
  | { status: 'fetching' }
  | { status: 'solving'; hashesComputed: number; hashRate: number }
  | { status: 'solved'; solution: PoWSolution }
  | { status: 'error'; error: string };

/**
 * Callback for PoW state changes
 */
export type PoWStateCallback = (state: PoWState) => void;

/**
 * Manager for background PoW computation
 *
 * Fetches a challenge and starts solving it immediately in a Web Worker.
 * The solution can be retrieved when needed (e.g., when user submits a form).
 */
export class BackgroundPoWSolver {
  private worker: Worker | null = null;
  private challenge: PoWChallenge | null = null;
  private solution: PoWSolution | null = null;
  private state: PoWState = { status: 'idle' };
  private stateCallback: PoWStateCallback | null = null;
  private fetchChallenge: () => Promise<PoWChallenge>;

  constructor(fetchChallenge: () => Promise<PoWChallenge>) {
    this.fetchChallenge = fetchChallenge;
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(callback: PoWStateCallback): void {
    this.stateCallback = callback;
    // Immediately notify of current state
    callback(this.state);
  }

  private setState(state: PoWState): void {
    this.state = state;
    this.stateCallback?.(state);
  }

  /**
   * Get current state
   */
  getState(): PoWState {
    return this.state;
  }

  /**
   * Get the solution if available
   */
  getSolution(): PoWSolution | null {
    return this.solution;
  }

  /**
   * Start fetching challenge and solving in background
   */
  async start(): Promise<void> {
    // Already running or solved
    if (this.state.status === 'solving' || this.state.status === 'solved') {
      return;
    }

    try {
      this.setState({ status: 'fetching' });

      // Fetch challenge from server
      this.challenge = await this.fetchChallenge();

      this.setState({ status: 'solving', hashesComputed: 0, hashRate: 0 });

      // Create worker and start solving
      this.worker = createPoWWorker();

      this.worker.onmessage = (e) => {
        if (e.data.type === 'progress') {
          this.setState({
            status: 'solving',
            hashesComputed: e.data.hashesComputed,
            hashRate: e.data.hashRate,
          });
        } else if (e.data.type === 'solved') {
          this.solution = {
            pow_challenge: this.challenge!.challenge,
            pow_timestamp: this.challenge!.timestamp,
            pow_difficulty: this.challenge!.difficulty,
            pow_signature: this.challenge!.signature,
            pow_solution: e.data.solution,
          };
          this.setState({ status: 'solved', solution: this.solution });
          this.cleanup();
        } else if (e.data.type === 'aborted') {
          this.setState({ status: 'idle' });
          this.cleanup();
        }
      };

      this.worker.onerror = (err) => {
        this.setState({ status: 'error', error: err.message || 'Worker error' });
        this.cleanup();
      };

      // Start solving
      this.worker.postMessage({
        type: 'solve',
        challengeStr: this.challenge.challenge,
        difficulty: this.challenge.difficulty,
      });
    } catch (err) {
      this.setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to start PoW',
      });
    }
  }

  /**
   * Wait for the solution to be ready
   * Returns immediately if already solved, otherwise waits
   */
  async waitForSolution(): Promise<PoWSolution> {
    // Already solved
    if (this.solution) {
      return this.solution;
    }

    // Not started yet - start now
    if (this.state.status === 'idle') {
      await this.start();
    }

    // Wait for solution
    return new Promise((resolve, reject) => {
      const checkState = (state: PoWState) => {
        if (state.status === 'solved') {
          resolve(state.solution);
        } else if (state.status === 'error') {
          reject(new Error(state.error));
        }
      };

      // Check current state
      if (this.state.status === 'solved') {
        resolve(this.solution!);
        return;
      }
      if (this.state.status === 'error') {
        reject(new Error(this.state.error));
        return;
      }

      // Subscribe to future state changes
      const originalCallback = this.stateCallback;
      this.stateCallback = (state) => {
        originalCallback?.(state);
        checkState(state);
      };
    });
  }

  /**
   * Abort computation and clean up
   */
  abort(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'abort' });
      this.cleanup();
    }
    this.setState({ status: 'idle' });
    this.solution = null;
    this.challenge = null;
  }

  private cleanup(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

// ==================== Utility Functions ====================

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
