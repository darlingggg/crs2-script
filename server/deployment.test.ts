import assert from 'node:assert/strict'
import test from 'node:test'
import { parseProjectOwners, resolveProjectOwners } from './deployment.ts'

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
