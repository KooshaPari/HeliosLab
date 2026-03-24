// Note: borrowed from path-browserify
// 'path' module extracted from Node.js v8.11.1 (only the posix part)
// Transplited with Babel

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// Copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// Without limitation the rights to use, copy, modify, merge, publish,
// Distribute, sublicense, and/or sell copies of the Software, and to permit
// Persons to whom the Software is furnished to do so, subject to the
// Following conditions:
//
// The above copyright notice and this permission notice shall be included
// In all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";
export const sep = "/";
export const delimiter = ":";

interface PathObject {
  root?: string;
  dir?: string;
  base?: string;
  ext?: string;
  name?: string;
}

export function assertPath(path: unknown): asserts path is string {
  if (typeof path !== "string") {
    throw new TypeError("Path must be a string. Received " + JSON.stringify(path));
  }
}

// Resolves . and .. elements in a path with directory names
export function normalizeStringPosix(path: string, allowAboveRoot: boolean) {
  var res = "";
  var lastSegmentLength = 0;
  var lastSlash = -1;
  var dots = 0;
  var code;
  for (var i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.codePointAt(i);
    } else if (code === 47 /*/*/) {
      break;
    } else {
      code = 47 /*/*/;
    }
    if (code === 47 /*/*/) {
      if (lastSlash === i - 1 || dots === 1) {
        // NOOP
      } else if (lastSlash !== i - 1 && dots === 2) {
        if (
          res.length < 2 ||
          lastSegmentLength !== 2 ||
          res.codePointAt(res.length - 1) !== 46 /*.*/ ||
          res.codePointAt(res.length - 2) !== 46 /*.*/
        ) {
          if (res.length > 2) {
            var lastSlashIndex = res.lastIndexOf("/");
            if (lastSlashIndex !== res.length - 1) {
              if (lastSlashIndex === -1) {
                res = "";
                lastSegmentLength = 0;
              } else {
                res = res.slice(0, lastSlashIndex);
                lastSegmentLength = res.length - 1 - res.lastIndexOf("/");
              }
              lastSlash = i;
              dots = 0;
              continue;
            }
          } else if (res.length === 2 || res.length === 1) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          if (res.length > 0) {
            res += "/..";
          } else {
            res = "..";
          }
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) {
          res += "/" + path.slice(lastSlash + 1, i);
        } else {
          res = path.slice(lastSlash + 1, i);
        }
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === 46 /*.*/ && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

function _format(sep: string, pathObject: PathObject) {
  var dir = pathObject.dir || pathObject.root;
  var base = pathObject.base || (pathObject.name || "") + (pathObject.ext || "");
  if (!dir) {
    return base;
  }
  if (dir === pathObject.root) {
    return dir + base;
  }
  return dir + sep + base;
}

// Path.resolve([from ...], to)
export function resolve(...pathSegments: string[]) {
  var resolvedPath = "";
  var resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path;
    if (i >= 0) {
      path = pathSegments[i];
    } else {
      // In browser environment, we don't have process.cwd()
      // Since we're always dealing with absolute paths in Colab, use "/" as fallback
      path = "/";
    }

    assertPath(path);

    // Skip empty entries
    if (path.length === 0) {
      continue;
    }

    resolvedPath = path + "/" + resolvedPath;
    resolvedAbsolute = path.codePointAt(0) === 47 /*/*/;
  }

  // At this point the path should be resolved to a full absolute path, but
  // Handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute);

  if (resolvedAbsolute) {
    if (resolvedPath.length > 0) {
      return "/" + resolvedPath;
    }
    return "/";
  } else if (resolvedPath.length > 0) {
    return resolvedPath;
  }
  return ".";
}

export function normalize(path: string) {
  assertPath(path);

  if (path.length === 0) {
    return ".";
  }

  var isAbsolute = path.codePointAt(0) === 47; /*/*/
  var trailingSeparator = path.codePointAt(path.length - 1) === 47; /*/*/

  // Normalize the path
  path = normalizeStringPosix(path, !isAbsolute);

  if (path.length === 0 && !isAbsolute) {
    path = ".";
  }
  if (path.length > 0 && trailingSeparator) {
    path += "/";
  }

  if (isAbsolute) {
    return "/" + path;
  }
  return path;
}

export function isAbsolute(path: string) {
  assertPath(path);
  return path.length > 0 && path.codePointAt(0) === 47 /*/*/;
}

export function join(...paths: string[]) {
  if (paths.length === 0) {
    return ".";
  }
  var joined;
  for (var i = 0; i < paths.length; ++i) {
    var arg = paths[i];
    assertPath(arg);
    if (arg.length > 0) {
      if (joined === undefined) {
        joined = arg;
      } else {
        joined += "/" + arg;
      }
    }
  }
  if (joined === undefined) {
    return ".";
  }
  return normalize(joined);
}

export function relative(from: string, to: string) {
  assertPath(from);
  assertPath(to);

  if (from === to) {
    return "";
  }

  from = resolve(from);
  to = resolve(to);

  if (from === to) {
    return "";
  }

  // Trim any leading backslashes
  var fromStart = 1;
  for (; fromStart < from.length; ++fromStart) {
    if (from.codePointAt(fromStart) !== 47 /*/*/) {
      break;
    }
  }
  var fromEnd = from.length;
  var fromLen = fromEnd - fromStart;

  // Trim any leading backslashes
  var toStart = 1;
  for (; toStart < to.length; ++toStart) {
    if (to.codePointAt(toStart) !== 47 /*/*/) {
      break;
    }
  }
  var toEnd = to.length;
  var toLen = toEnd - toStart;

  // Compare paths to find the longest common path from root
  var length = fromLen < toLen ? fromLen : toLen;
  var lastCommonSep = -1;
  var i = 0;
  for (; i <= length; ++i) {
    if (i === length) {
      if (toLen > length) {
        if (to.codePointAt(toStart + i) === 47 /*/*/) {
          // We get here if `from` is the exact base path for `to`.
          // For example: from='/foo/bar'; to='/foo/bar/baz'
          return to.slice(toStart + i + 1);
        } else if (i === 0) {
          // We get here if `from` is the root
          // For example: from='/'; to='/foo'
          return to.slice(toStart + i);
        }
      } else if (fromLen > length) {
        if (from.codePointAt(fromStart + i) === 47 /*/*/) {
          // We get here if `to` is the exact base path for `from`.
          // For example: from='/foo/bar/baz'; to='/foo/bar'
          lastCommonSep = i;
        } else if (i === 0) {
          // We get here if `to` is the root.
          // For example: from='/foo'; to='/'
          lastCommonSep = 0;
        }
      }
      break;
    }
    var fromCode = from.codePointAt(fromStart + i);
    var toCode = to.codePointAt(toStart + i);
    if (fromCode !== toCode) {
      break;
    } else if (fromCode === 47 /*/*/) {
      lastCommonSep = i;
    }
  }

  var out = "";
  // Generate the relative path based on the path difference between `to`
  // And `from`
  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
    if (i === fromEnd || from.codePointAt(i) === 47 /*/*/) {
      if (out.length === 0) {
        out += "..";
      } else {
        out += "/..";
      }
    }
  }

  // Lastly, append the rest of the destination (`to`) path that comes after
  // The common path parts
  if (out.length > 0) {
    return out + to.slice(toStart + lastCommonSep);
  }
  toStart += lastCommonSep;
  if (to.codePointAt(toStart) === 47 /*/*/) {
    ++toStart;
  }
  return to.slice(toStart);
}

export function _makeLong(path: string) {
  return path;
}

export function dirname(path: string) {
  assertPath(path);
  if (path.length === 0) {
    return ".";
  }
  var code = path.codePointAt(0);
  var hasRoot = code === 47; /*/*/
  var end = -1;
  var matchedSlash = true;
  for (var i = path.length - 1; i >= 1; --i) {
    code = path.codePointAt(i);
    if (code === 47 /*/*/) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      // We saw the first non-path separator
      matchedSlash = false;
    }
  }

  if (end === -1) {
    return hasRoot ? "/" : ".";
  }
  if (hasRoot && end === 1) {
    return "//";
  }
  return path.slice(0, end);
}

export function basename(path: string, ext?: string) {
  if (ext !== undefined && typeof ext !== "string") {
    throw new TypeError('"ext" argument must be a string');
  }
  assertPath(path);

  var start = 0;
  var end = -1;
  var matchedSlash = true;
  var i;

  if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
    if (ext.length === path.length && ext === path) {
      return "";
    }
    var extIdx = ext.length - 1;
    var firstNonSlashEnd = -1;
    for (i = path.length - 1; i >= 0; --i) {
      var code = path.codePointAt(i);
      if (code === 47 /*/*/) {
        // If we reached a path separator that was not part of a set of path
        // Separators at the end of the string, stop now
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1) {
          // We saw the first non-path separator, remember this index in case
          // We need it if the extension ends up not matching
          matchedSlash = false;
          firstNonSlashEnd = i + 1;
        }
        if (extIdx >= 0) {
          // Try to match the explicit extension
          if (code === ext.codePointAt(extIdx)) {
            if (--extIdx === -1) {
              // We matched the extension, so mark this as the end of our path
              // Component
              end = i;
            }
          } else {
            // Extension does not match, so our result is the entire path
            // Component
            extIdx = -1;
            end = firstNonSlashEnd;
          }
        }
      }
    }

    if (start === end) {
      end = firstNonSlashEnd;
    } else if (end === -1) {
      end = path.length;
    }
    return path.slice(start, end);
  }
  for (i = path.length - 1; i >= 0; --i) {
    if (path.codePointAt(i) === 47 /*/*/) {
      // If we reached a path separator that was not part of a set of path
      // separators at the end of the string, stop now
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // path component
      matchedSlash = false;
      end = i + 1;
    }
  }

  if (end === -1) {
    return "";
  }
  return path.slice(start, end);
}

export function extname(path: string) {
  assertPath(path);
  var startDot = -1;
  var startPart = 0;
  var end = -1;
  var matchedSlash = true;
  // Track the state of characters (if any) we see before our first dot and
  // After any path separator we find
  var preDotState = 0;
  for (var i = path.length - 1; i >= 0; --i) {
    var code = path.codePointAt(i);
    if (code === 47 /*/*/) {
      // If we reached a path separator that was not part of a set of path
      // Separators at the end of the string, stop now
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // Extension
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46 /*.*/) {
      // If this is our first dot, mark it as the start of our extension
      if (startDot === -1) {
        startDot = i;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot !== -1) {
      // We saw a non-dot and non-path separator before our dot, so we should
      // Have a good chance at having a non-empty extension
      preDotState = -1;
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    // We saw a non-dot character immediately before the dot
    preDotState === 0 ||
    // The (right-most) trimmed path component is exactly '..'
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    return "";
  }
  return path.slice(startDot, end);
}

export function format(pathObject: PathObject) {
  if (pathObject === null || typeof pathObject !== "object") {
    throw new TypeError(
      'The "pathObject" argument must be of type Object. Received type ' + typeof pathObject,
    );
  }
  return _format("/", pathObject);
}

export function parse(path: string) {
  assertPath(path);

  var ret = { root: "", dir: "", base: "", ext: "", name: "" };
  if (path.length === 0) {
    return ret;
  }
  var code = path.codePointAt(0);
  var isAbsolute = code === 47; /*/*/
  var start;
  if (isAbsolute) {
    ret.root = "/";
    start = 1;
  } else {
    start = 0;
  }
  var startDot = -1;
  var startPart = 0;
  var end = -1;
  var matchedSlash = true;
  var i = path.length - 1;

  // Track the state of characters (if any) we see before our first dot and
  // After any path separator we find
  var preDotState = 0;

  // Get non-dir info
  for (; i >= start; --i) {
    code = path.codePointAt(i);
    if (code === 47 /*/*/) {
      // If we reached a path separator that was not part of a set of path
      // Separators at the end of the string, stop now
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // Extension
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46 /*.*/) {
      // If this is our first dot, mark it as the start of our extension
      if (startDot === -1) {
        startDot = i;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot !== -1) {
      // We saw a non-dot and non-path separator before our dot, so we should
      // Have a good chance at having a non-empty extension
      preDotState = -1;
    }
  }

  if (
    startDot === -1 ||
    end === -1 ||
    // We saw a non-dot character immediately before the dot
    preDotState === 0 ||
    // The (right-most) trimmed path component is exactly '..'
    (preDotState === 1 && startDot === end - 1 && startDot === startPart + 1)
  ) {
    if (end !== -1) {
      if (startPart === 0 && isAbsolute) {
        ret.base = ret.name = path.slice(1, end);
      } else {
        ret.base = ret.name = path.slice(startPart, end);
      }
    }
  } else {
    if (startPart === 0 && isAbsolute) {
      ret.name = path.slice(1, startDot);
      ret.base = path.slice(1, end);
    } else {
      ret.name = path.slice(startPart, startDot);
      ret.base = path.slice(startPart, end);
    }
    ret.ext = path.slice(startDot, end);
  }

  if (startPart > 0) {
    ret.dir = path.slice(0, startPart - 1);
  } else if (isAbsolute) {
    ret.dir = "/";
  }

  return ret;
}
