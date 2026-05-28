#!/usr/bin/env bun

import { execSync } from "child_process";
import { cpSync, mkdirSync, existsSync, writeFileSync } from "fs";
import path from "path";

console.log("Setting up build dependencies...");

// Vendor and build Zig PTY binary
await vendorZig();

// Vendor llama.cpp and build llama-cli
await vendorLlama();
await buildLlamaLibraries();

console.log("✅ All dependencies ready!");

// Zig vendoring functions  
async function vendorCmake() {
    const cmakeBinary = process.platform === 'win32' ? 'cmake.exe' : 'cmake';
    const cmakeBinPath = process.platform === 'darwin' 
        ? path.join('./vendors/cmake/CMake.app/Contents/bin', cmakeBinary)
        : path.join('./vendors/cmake/bin', cmakeBinary);
    
    // Check if CMake is already available
    if (existsSync(cmakeBinPath)) {
        console.log("--------> CMake already vendored");
        return;
    }
    
    console.log("--------> Vendoring CMake...");
    
    const platform = process.platform;
    const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    
    if (platform === 'darwin') {
        // Download and extract CMake for macOS
        const cmakeVersion = '3.28.3';
        const cmakeUrl = arch === 'arm64' 
            ? `https://github.com/Kitware/CMake/releases/download/v${cmakeVersion}/cmake-${cmakeVersion}-macos-universal.tar.gz`
            : `https://github.com/Kitware/CMake/releases/download/v${cmakeVersion}/cmake-${cmakeVersion}-macos-universal.tar.gz`;
        
        execSync(`mkdir -p vendors/cmake && curl -L ${cmakeUrl} | tar -xz --strip-components=1 -C vendors/cmake`, {});
        console.log("--------> CMake vendored for macOS");
    } else if (platform === 'linux') {
        // Download and extract CMake for Linux
        const cmakeVersion = '3.28.3';
        const cmakeUrl = `https://github.com/Kitware/CMake/releases/download/v${cmakeVersion}/cmake-${cmakeVersion}-linux-${arch}.tar.gz`;
        
        execSync(`mkdir -p vendors/cmake && curl -L ${cmakeUrl} | tar -xz --strip-components=1 -C vendors/cmake`, {});
        console.log("--------> CMake vendored for Linux");
    } else if (platform === 'win32') {
        // Download and extract CMake for Windows
        const cmakeVersion = '3.28.3';
        const cmakeUrl = `https://github.com/Kitware/CMake/releases/download/v${cmakeVersion}/cmake-${cmakeVersion}-windows-${arch}.zip`;
        
        execSync(`mkdir -p vendors/cmake && curl -L ${cmakeUrl} -o vendors/cmake.zip && powershell -ExecutionPolicy Bypass -Command Expand-Archive -Path vendors/cmake.zip -DestinationPath vendors/cmake-temp && mv vendors/cmake-temp/cmake-${cmakeVersion}-windows-${arch}/* vendors/cmake/`, {});
        console.log("--------> CMake vendored for Windows");
    }
}

async function vendorZig() {
    const zigBinary = process.platform === 'win32' ? 'zig.exe' : 'zig';
    const zigBinPath = path.join('./vendors/zig', zigBinary);
    
    // Check if Zig is already available
    if (existsSync(zigBinPath)) {
        console.log("--------> Zig already vendored");
        return;
    }
    
    console.log("--------> Vendoring Zig...");
    
    const platform = process.platform;
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    
    if (platform === 'darwin') {
        execSync(`mkdir -p vendors/zig && curl -L https://ziglang.org/download/0.13.0/zig-macos-${arch}-0.13.0.tar.xz | tar -xJ --strip-components=1 -C vendors/zig zig-macos-${arch}-0.13.0/zig zig-macos-${arch}-0.13.0/lib zig-macos-${arch}-0.13.0/doc`, {});
        console.log("--------> Zig vendored for macOS");
    } else if (platform === 'linux') {
        execSync(`mkdir -p vendors/zig && curl -L https://ziglang.org/download/0.13.0/zig-linux-${arch}-0.13.0.tar.xz | tar -xJ --strip-components=1 -C vendors/zig zig-linux-${arch}-0.13.0/zig zig-linux-${arch}-0.13.0/lib zig-linux-${arch}-0.13.0/doc`, {});
        console.log("--------> Zig vendored for Linux");  
    } else if (platform === 'win32') {
        const zigFolder = `zig-windows-${arch}-0.13.0`;
        execSync(`mkdir -p vendors/zig && curl -L https://ziglang.org/download/0.13.0/${zigFolder}.zip -o vendors/zig.zip && powershell -ExecutionPolicy Bypass -Command Expand-Archive -Path vendors/zig.zip -DestinationPath vendors/zig-temp && mv vendors/zig-temp/${zigFolder}/zig.exe vendors/zig && mv vendors/zig-temp/${zigFolder}/lib vendors/zig/`, {});
        console.log("--------> Zig vendored for Windows");
    }
}

async function vendorLlama() {
    const llamaPath = path.join("llama-cli", "deps", "llama.cpp");
    const cmakeListsPath = path.join(llamaPath, "CMakeLists.txt");
    
    // Check if llama.cpp is already available and complete
    if (existsSync(cmakeListsPath)) {
        console.log("--------> llama.cpp already vendored");
        return;
    }
    
    console.log("--------> Vendoring llama.cpp...");
    
    try {
        // Ensure the deps directory exists
        const depsDir = path.join("llama-cli", "deps");
        if (!existsSync(depsDir)) {
            mkdirSync(depsDir, { recursive: true });
            console.log("--------> Created deps directory");
        }
        
        // If llama.cpp directory exists but is incomplete, remove it
        if (existsSync(llamaPath)) {
            console.log("--------> Removing incomplete llama.cpp directory");
            execSync(`rm -rf "${llamaPath}"`, {});
        }
        
        // Check if the setup script exists
        const setupScriptPath = path.join("llama-cli", "setup-llama.sh");
        if (!existsSync(setupScriptPath)) {
            console.error("--------> setup-llama.sh not found at:", setupScriptPath);
            throw new Error("setup-llama.sh script not found");
        }
        
        // Run the setup script to clone llama.cpp
        console.log("--------> Running setup-llama.sh...");
        execSync("cd llama-cli && chmod +x setup-llama.sh && ./setup-llama.sh", { stdio: 'inherit' });
        
        // Verify it was cloned successfully
        if (existsSync(cmakeListsPath)) {
            console.log("--------> llama.cpp vendored successfully");
        } else {
            console.error("--------> Debug: llamaPath =", llamaPath);
            console.error("--------> Debug: cmakeListsPath =", cmakeListsPath);
            console.error("--------> Debug: llamaPath exists =", existsSync(llamaPath));
            console.error("--------> Debug: Contents of deps dir:");
            try {
                execSync("ls -la llama-cli/deps/", { stdio: 'inherit' });
            } catch (e) {
                console.error("Could not list deps directory");
            }
            throw new Error("llama.cpp was not cloned properly - CMakeLists.txt not found");
        }
    } catch (error) {
        console.error("--------> Failed to vendor llama.cpp:", error);
        throw error;
    }
}

async function buildLlamaLibraries() {
    const zigBinary = process.platform === 'win32' ? 'zig.exe' : 'zig';
    const zigBinPath = path.join('./vendors/zig', zigBinary);
    
    if (!existsSync(zigBinPath)) {
        console.error("Zig not found, cannot build llama libraries");
        return;
    }
    
    console.log("--------> Building llama.cpp libraries...");
    
    try {
        // Ensure llama.cpp is vendored
        await vendorLlama();
        
        // Build the llama.cpp libraries using CMake first
        const llamaCppDir = path.resolve("llama-cli", "deps", "llama.cpp");
        const buildDir = path.join(llamaCppDir, "build");
        
        // Only build if the libraries don't already exist
        const libLlamaPath = path.join(buildDir, "src", "libllama.a");
        if (existsSync(libLlamaPath)) {
            console.log("--------> llama.cpp libraries already exist, skipping build");
            return;
        }
        
        console.log("--------> Building llama.cpp libraries...");
        
        // Ensure cmake is available
        await vendorCmake();
        
        const cmakeBinary = process.platform === 'win32' ? 'cmake.exe' : 'cmake';
        const cmakeBinPath = process.platform === 'darwin' 
            ? path.join('./vendors/cmake/CMake.app/Contents/bin', cmakeBinary)
            : path.join('./vendors/cmake/bin', cmakeBinary);
        
        // Create build directory
        execSync(`mkdir -p ${buildDir}`, {});
        
        // Configure with cmake (CPU only, no Metal/CUDA)
        const absoluteCmakePath = path.resolve(cmakeBinPath);
        const cmakeConfigCommand = `cd ${buildDir} && ${absoluteCmakePath} ${llamaCppDir} -DGGML_METAL=OFF -DGGML_CUDA=OFF -DGGML_OPENMP=OFF -DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release`;
        execSync(cmakeConfigCommand, { stdio: 'inherit' });
        
        // Build the libraries
        const cmakeBuildCommand = `cd ${buildDir} && ${absoluteCmakePath} --build . --config Release`;
        execSync(cmakeBuildCommand, { stdio: 'inherit' });
        
        console.log("--------> llama.cpp libraries built successfully");
        
        // Set has_llama = true in build options
        const buildOptionsPath = path.join("llama-cli", "src", "build_options_default.zig");
        const buildOptionsContent = "pub const has_llama = true;\n";
        writeFileSync(buildOptionsPath, buildOptionsContent);
        console.log("--------> Set has_llama = true in build options");
        
    } catch (error) {
        console.error("--------> Failed to build llama libraries:", error);
        throw error;
    }
}