/** Latest release of the official Tasmota firmware */
const TASMOTA_RELEASE_URL = 'https://api.github.com/repos/arendst/Tasmota/releases/latest';

/**
 * Parses the version of a Tasmota firmware into its numbers.
 *
 * Tasmota reports the version together with the build variant, e.g. "14.2.0(tasmota)" or
 * "15.0.1(release-tasmota32)". Development builds have a fourth number ("15.0.1.3(tasmota)"),
 * the GitHub release is tagged with a leading "v" ("v15.0.1").
 *
 * @param version version as reported by the device or as tag of the release
 * @returns the numbers of the version or null if it is not a Tasmota version
 */
export function parseVersion(version: string | null | undefined): number[] | null {
    const match = typeof version === 'string' ? version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/) : null;
    if (!match) {
        return null;
    }
    return [match[1], match[2], match[3], match[4] || '0'].map(n => parseInt(n, 10));
}

/**
 * Whether the available version is newer than the installed one. A development build is newer than the
 * release with the same first three numbers, so it is not offered to be "updated" to this release.
 *
 * @param available version of the release, e.g. "v15.0.1"
 * @param installed version reported by the device, e.g. "14.2.0(tasmota)"
 */
export function isNewerVersion(available: string | null | undefined, installed: string | null | undefined): boolean {
    const a = parseVersion(available);
    const b = parseVersion(installed);
    if (!a || !b) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return a[i] > b[i];
        }
    }
    return false;
}

/**
 * Reads the version of the latest Tasmota release from GitHub.
 *
 * @returns the version without the leading "v", e.g. "15.0.1"
 */
export async function fetchLatestTasmotaVersion(): Promise<string> {
    const response = await fetch(TASMOTA_RELEASE_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ioBroker.sonoff' },
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
        throw new Error(`GitHub answered with ${response.status} ${response.statusText}`);
    }
    const release = (await response.json()) as { tag_name?: string };
    const version = parseVersion(release.tag_name);
    if (!version) {
        throw new Error(`Unknown version "${release.tag_name}"`);
    }
    return version.slice(0, 3).join('.');
}
