// Self-contained ULID generation with monotonic ordering
// Zero runtime dependencies — uses crypto.getRandomValues (available in Bun)

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ" as const;
const ENCODING_LEN = 32;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

let lastTimestamp = 0;
let lastRandom: number[] = [];

function encodeTime(timestamp: number): string {
	if (timestamp < 0 || timestamp > 281474976710655) {
		throw new RangeError("Timestamp must be between 0 and 281474976710655");
	}
	let result = "";
	let t = timestamp;
	for (let i = TIME_LEN - 1; i >= 0; i--) {
		result = CROCKFORD_BASE32[t % ENCODING_LEN] + result;
		t = Math.floor(t / ENCODING_LEN);
	}
	return result;
}

function randomValues(count: number): Uint8Array {
	const buffer = new Uint8Array(count);
	crypto.getRandomValues(buffer);
	return buffer;
}

function generateRandomChars(): number[] {
	const bytes = randomValues(RANDOM_LEN);
	const chars: number[] = new Array(RANDOM_LEN);
	for (let i = 0; i < RANDOM_LEN; i++) {
		chars[i] = bytes[i] % ENCODING_LEN;
	}
	return chars;
}

function incrementRandom(random: number[]): number[] {
	const result = random.slice();
	for (let i = result.length - 1; i >= 0; i--) {
		result[i]++;
		if (result[i] < ENCODING_LEN) {
			return result;
		}
		result[i] = 0;
	}
	throw new Error("ULID random component overflow — retry in next millisecond");
}

function encodeRandom(chars: number[]): string {
	let result = "";
	for (let i = 0; i < RANDOM_LEN; i++) {
		result += CROCKFORD_BASE32[chars[i]];
	}
	return result;
}

function generateUlid(): string {
	let now = Date.now();

	// Handle backward clock — always move forward
	if (now <= lastTimestamp) {
		now = lastTimestamp;
	}

	if (now === lastTimestamp) {
		lastRandom = incrementRandom(lastRandom);
	} else {
		lastTimestamp = now;
		lastRandom = generateRandomChars();
	}

	return encodeTime(now) + encodeRandom(lastRandom);
}

function decodeTime(encoded: string): number {
	if (encoded.length !== TIME_LEN) {
		throw new RangeError("Time component must be exactly 10 characters");
	}
	let timestamp = 0;
	for (let i = 0; i < TIME_LEN; i++) {
		const idx = CROCKFORD_BASE32.indexOf(encoded[i]);
		if (idx === -1) {
			throw new Error(`Invalid Crockford base32 character: ${encoded[i]}`);
		}
		timestamp = timestamp * ENCODING_LEN + idx;
	}
	return timestamp;
}

export { generateUlid, encodeTime, decodeTime, CROCKFORD_BASE32 };
