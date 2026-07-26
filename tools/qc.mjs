import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const runner = path.join(root, 'tools', 'qc-electron.cjs')
const electronPackage = path.join(root, 'desktop', 'node_modules', 'electron', 'package.json')

function execute(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('npm.cmd'),
  })
}

function run(command, args) {
  const result = execute(command, args)
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// QC is intentionally more than a build: it captures the title and town states after rendering.
const standardBuild = execute(npm, ['run', 'build'])
if (standardBuild.status !== 0) {
  // The Codex workspace sandbox can block Vite's config-file scan above the repository.
  // Re-run the identical TypeScript/Vite build without config discovery; source failures still fail QC.
  console.warn('Standard Vite config scan failed; retrying the sandbox-safe build path for QC.')
  run(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-b'])
  run(process.execPath, ['-e', "import('vite').then(({build}) => build({ configFile: false, base: './' }))"])
}

if (!existsSync(electronPackage)) {
  console.error('QC requires the desktop renderer. Run: npm --prefix desktop install')
  process.exit(1)
}

const require = createRequire(import.meta.url)
const electron = require(path.join(root, 'desktop', 'node_modules', 'electron'))
run(electron, [runner])

const contact = path.join(root, 'qc-out', 'contact.png')
if (!existsSync(contact)) {
  console.error('QC did not create qc-out/contact.png')
  process.exit(1)
}
console.log(`QC complete: ${contact}`)
