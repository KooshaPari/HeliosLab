/**
 * npm Registry integration for discovering Colab plugins
 *
 * Searches npm for packages with the "colab-plugin" keyword
 */

import type { NpmPackageInfo, NpmSearchResult, PluginManifest } from './types';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const NPM_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';

// ============================================================================
// Search
// ============================================================================

export interface SearchOptions {
  /** Search query text */
  query?: string;
  /** Number of results to return (default 20, max 250) */
  size?: number;
  /** Offset for pagination */
  from?: number;
}

export interface SearchResultItem {
  name: string;
  version: string;
  description?: string;
  author?: string;
  keywords?: string[];
  date: string;
  score: number;
  hasColabPlugin: boolean;
}

/**
 * Search npm for Colab plugins
 * Automatically filters to packages with the "colab-plugin" keyword
 */
export async function searchPlugins(options: SearchOptions = {}): Promise<{
  results: SearchResultItem[];
  total: number;
}> {
  const { query = '', size = 20, from = 0 } = options;

  // Always include colab-plugin keyword in search
  const searchQuery = query
    ? `${query} keywords:colab-plugin`
    : 'keywords:colab-plugin';

  const url = new URL(NPM_SEARCH_URL);
  url.searchParams.set('text', searchQuery);
  url.searchParams.set('size', String(Math.min(size, 250)));
  url.searchParams.set('from', String(from));

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`npm search failed: ${response.status} ${response.statusText}`);
  }

  const data: NpmSearchResult = await response.json();

  let results: SearchResultItem[] = data.objects.map((obj) => ({
    name: obj.package.name,
    version: obj.package.version,
    description: obj.package.description,
    author: obj.package.author?.name || obj.package.publisher?.username,
    keywords: obj.package.keywords,
    date: obj.package.date,
    score: obj.score.final,
    hasColabPlugin: obj.package.keywords?.includes('colab-plugin') ?? false,
  }));

  // If there's a search query, filter results to only include packages where
  // the query appears in the name, description, or keywords.
  // npm's fuzzy search returns low-relevance results when the result set is small.
  if (query) {
    const lowerQuery = query.toLowerCase();
    results = results.filter((pkg) => {
      const searchableText = [
        pkg.name,
        pkg.description,
        ...(pkg.keywords || []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchableText.includes(lowerQuery);
    });
  }

  return {
    results,
    total: results.length,
  };
}

// ============================================================================
// Package Info
// ============================================================================

/**
 * Get detailed package information from npm
 */
export async function getPackageInfo(packageName: string, version?: string): Promise<NpmPackageInfo | null> {
  const versionPath = version ? `/${version}` : '/latest';
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}${versionPath}`;

  const response = await fetch(url);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`npm fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  return {
    name: data.name,
    version: data.version,
    description: data.description,
    author: data.author,
    keywords: data.keywords,
    repository: data.repository,
    homepage: data.homepage,
    license: data.license,
    'colab-plugin': data['colab-plugin'],
  };
}

/**
 * Get all available versions of a package
 */
export async function getPackageVersions(packageName: string): Promise<string[]> {
  const url = `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}`;

  const response = await fetch(url);

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(`npm fetch failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Return versions sorted by semver descending
  const versions = Object.keys(data.versions || {});
  return versions.sort((a, b) => {
    // Simple semver comparison - could use a proper library
    const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
    const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
    if (bMajor !== aMajor) return bMajor - aMajor;
    if (bMinor !== aMinor) return bMinor - aMinor;
    return bPatch - aPatch;
  });
}

/**
 * Validate that a package is a valid Colab plugin
 */
export async function validatePlugin(packageName: string, version?: string): Promise<{
  valid: boolean;
  manifest?: PluginManifest;
  error?: string;
}> {
  try {
    const info = await getPackageInfo(packageName, version);

    if (!info) {
      return { valid: false, error: 'Package not found' };
    }

    // Check for colab-plugin field
    if (!info['colab-plugin']) {
      return { valid: false, error: 'Package does not have a colab-plugin configuration' };
    }

    // Check for colab-plugin keyword (soft requirement)
    if (!info.keywords?.includes('colab-plugin')) {
      console.warn(`Package ${packageName} is missing "colab-plugin" keyword`);
    }

    return {
      valid: true,
      manifest: info['colab-plugin'],
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Popular/Featured Plugins
// ============================================================================

/**
 * Get popular Colab plugins sorted by download count
 */
export async function getPopularPlugins(limit = 10): Promise<SearchResultItem[]> {
  const result = await searchPlugins({
    query: '',
    size: limit,
  });

  // npm search already sorts by popularity/quality/maintenance combined
  return result.results;
}

/**
 * Get recently updated Colab plugins
 */
export async function getRecentPlugins(limit = 10): Promise<SearchResultItem[]> {
  const result = await searchPlugins({
    query: '',
    size: 50, // Fetch more to sort
  });

  // Sort by date descending
  return result.results
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}
