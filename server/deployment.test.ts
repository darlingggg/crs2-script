import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import express from 'express'
import { parseProjectOwners, registerDeploymentRoutes, resolveProjectOwners, retryRelease, validateWorkflowConfig } from './deployment.ts'

test('resolves git usernames embedded by newer crs2 owner output', () => {
  const output = [
    '| 项目名 | Owner |',
    '| mt-web | junliang.huang(黄俊良), junyu.hou(侯俊宇), bo.yao(姚博) |',
  ].join('\n')

  const parsed = parseProjectOwners(output)
  assert.deepEqual(resolveProjectOwners(parsed.owners, {}), [
    { displayName: '黄俊良', gitUserName: 'junliang.huang', mapped: true },
    { displayName: '侯俊宇', gitUserName: 'junyu.hou', mapped: true },
    { displayName: '姚博', gitUserName: 'bo.yao', mapped: true },
  ])
})

test('keeps supporting the legacy display-name mapping', () => {
  const owners = resolveProjectOwners(['黄俊良', '侯俊宇'], {
    黄俊良: 'junliang.huang',
    侯俊宇: 'junyu.hou',
  })

  assert.equal(owners[1].gitUserName, 'junyu.hou')
})

test('validates the editable workflow config', async () => {
  const config = JSON.parse(await readFile(new URL('../deploy.workflow.json', import.meta.url), 'utf8'))
  assert.equal(validateWorkflowConfig(config).targetBranch, 'master')

  const invalid = structuredClone(config)
  delete invalid.commands.merge
  assert.throws(() => validateWorkflowConfig(invalid), /commands\.merge 配置不完整/)

  const missingRetry = structuredClone(config)
  delete missingRetry.testReleaseRetry
  assert.throws(() => validateWorkflowConfig(missingRetry), /testReleaseRetry 配置不完整/)
})

test('release succeeds immediately without waiting or retrying', async () => {
  const attempts: number[] = []
  const waits: number[] = []
  await retryRelease(
    { intervalMs: 15000, maxAttempts: 2 },
    async (attempt) => { attempts.push(attempt) },
    async (ms) => { waits.push(ms) },
    () => assert.fail('unexpected retry'),
  )
  assert.deepEqual(attempts, [1])
  assert.deepEqual(waits, [])
})

test('release retries once after 15 seconds and stops after a second failure', async () => {
  const attempts: number[] = []
  const waits: number[] = []
  const retries: number[] = []
  await assert.rejects(
    retryRelease(
      { intervalMs: 15000, maxAttempts: 2 },
      async (attempt) => { attempts.push(attempt); throw new Error(`failure ${attempt}`) },
      async (ms) => { waits.push(ms) },
      (nextAttempt) => { retries.push(nextAttempt) },
    ),
    /failure 2/,
  )
  assert.deepEqual(attempts, [1, 2])
  assert.deepEqual(waits, [15000])
  assert.deepEqual(retries, [2])
})

test('release can succeed on its single retry', async () => {
  const attempts: number[] = []
  await retryRelease(
    { intervalMs: 15000, maxAttempts: 2 },
    async (attempt) => {
      attempts.push(attempt)
      if (attempt === 1) throw new Error('temporary error')
    },
    async () => undefined,
    () => undefined,
  )
  assert.deepEqual(attempts, [1, 2])
})

test('saves validated workflow config through the API', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'launchline-config-'))
  const configPath = join(directory, 'deploy.workflow.json')
  const ownerMapPath = join(directory, 'project-owner-map.json')
  const original = JSON.parse(await readFile(new URL('../deploy.workflow.json', import.meta.url), 'utf8'))
  await writeFile(configPath, JSON.stringify(original), 'utf8')
  await writeFile(ownerMapPath, '{}', 'utf8')

  const app = express()
  app.use(express.json())
  registerDeploymentRoutes(app, configPath, ownerMapPath, {
    inspectRepository: async () => ({ isGitRepository: false }),
    syncPackageOwner: async () => ({ changed: false, message: '' }),
  })
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))

  try {
    const port = (server.address() as AddressInfo).port
    const updated = structuredClone(original)
    updated.display.testTask = 'config-api-test'
    const response = await fetch(`http://127.0.0.1:${port}/api/deployment/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: updated }),
    })
    assert.equal(response.status, 200)
    assert.equal(JSON.parse(await readFile(configPath, 'utf8')).display.testTask, 'config-api-test')

    const invalidResponse = await fetch(`http://127.0.0.1:${port}/api/deployment/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: { version: 2 } }),
    })
    assert.equal(invalidResponse.status, 400)
    assert.equal(JSON.parse(await readFile(configPath, 'utf8')).display.testTask, 'config-api-test')
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
