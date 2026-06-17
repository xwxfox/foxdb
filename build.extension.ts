import { spawnSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import path from "path";

const baseDir = path.join(import.meta.dirname, "./src/sqlExtension");
const includeDir = path.join(baseDir, "include");
const cFile = path.join(baseDir, "stmt_stats_ext.c");
const distDir = path.join(baseDir, "bin");

const allExists: [boolean, boolean, boolean] = [
    existsSync(baseDir),
    existsSync(includeDir),
    existsSync(cFile),
]

if (!allExists.every((v, i) => v == true)) {
    console.log(baseDir, includeDir, cFile)
    console.log(allExists)
    throw new Error("Soma paths doesnt seem to exist")
}

if (!existsSync(distDir)) {
    mkdirSync(distDir)
}

const targets = [
    { triple: "x86_64-linux-gnu", out: "stmt_stats_ext-linux-x64.so", flags: ["-fPIC", "-shared", "-pthread"] },
    { triple: "aarch64-linux-gnu", out: "stmt_stats_ext-linux-arm64.so", flags: ["-fPIC", "-shared", "-pthread"] },
    { triple: "aarch64-macos", out: "stmt_stats_ext-darwin-arm64.dylib", flags: ["-dynamiclib"] },
    { triple: "x86_64-macos", out: "stmt_stats_ext-darwin-x64.dylib", flags: ["-dynamiclib"] },
    { triple: "x86_64-windows-gnu", out: "stmt_stats_ext-windows-x64.dll", flags: ["-shared"] }
];

for (const t of targets) {
    console.log(`Building for ${t.triple}...`);
    const args = [
        "cc",
        "-target", t.triple,
        "-O2",
        `-I${includeDir}`,
        "-o", path.join(distDir, t.out),
        cFile,
        ...t.flags
    ];

    const res = spawnSync("zig", args, { stdio: "inherit" });
    if (res.status !== 0) {
        console.error(`Failed building for ${t.triple}`);
    } else {
        console.log(`Successfully built ${t.out}`);
    }
}