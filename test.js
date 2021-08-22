'use strict'

const test = require('tape')
const createServer = require('./')

test('constructor', (t) => {
	t.equal(typeof createServer, 'function')

	const server = createServer({fetch: () => undefined})
	t.equal(typeof server.RateLimitError, 'function')
	t.equal(typeof server.TimeoutError, 'function')
	t.equal(typeof server.ServerError, 'function')
	t.equal(typeof server.ResponseError, 'function')

	t.equal(typeof server.tokenize, 'function')
	t.equal(typeof server.payments.create, 'function')

	t.end()
})

test('custom "fetch"', (t) => {
	t.plan(1)

	const server = createServer({
		retryAfter: () => false,
		fetch: () => Promise.reject(new Error('test')),
	})

	server.tokenize('abc', 'cba').catch((err) => t.equal(err.message, 'test'))
})

test('default retries (failure)', (t) => {
	t.plan(2)

	const logs = []
	const clock = createClock(() => undefined, 1000000)
	const server = createServer({
		clock,
		fetch: () => {
			logs.push({t: 'called', now: clock.now()})
			return Promise.reject(new Error('test'))
		},
	})
	server.tokenize('abc', 'cba').catch((err) => {
		t.equal(err.message, 'test')
		t.deepEqual(logs, [
			{t: 'called', now: 1000000}, // initial
			{t: 'called', now: 1000000}, // immediate retry
			{t: 'called', now: 1000100},
			{t: 'called', now: 1002100},
			{t: 'called', now: 1012100},
			{t: 'called', now: 1022100},
			{t: 'called', now: 1032100},
			{t: 'called', now: 1042100},
			{t: 'called', now: 1052100},
			{t: 'called', now: 1062100},
			{t: 'called', now: 1072100},
		])
	})
	clock.increase(200_000)
})

test('retries halt on "ResponseError"', (t) => {
	t.plan(3)

	const logs = []
	const clock = createClock(() => undefined, 1000000)
	const server = createServer({
		clock,
		fetch: () => {
			logs.push({t: 'called', now: clock.now()})
			return Promise.resolve({
				status: 400,
				statusText: 'Some error',
				headers: new Map([['content-type', 'application/json']]),
				json: () => Promise.resolve({code: 'SomeError'}),
			})
		},
	})
	server.tokenize('abc', 'cba').catch((err) => {
		t.ok(err instanceof server.ResponseError)
		t.equal(err.code, 'SomeError')
		t.deepEqual(logs, [{t: 'called', now: 1000000}])
	})
})

test('default retries with eventual success', (t) => {
	t.plan(1)

	let count = 0
	const logs = []
	const clock = createClock(() => undefined, 1000000)
	const server = createServer({
		clock,
		fetch: () => {
			logs.push({t: 'called', now: clock.now()})
			if (count++ < 3) {
				return Promise.reject(new Error('test'))
			} else {
				return Promise.resolve({
					status: 204,
					statusText: 'OK',
					headers: new Map([['content-type', 'application/json']]),
				})
			}
		},
	})
	server.tokenize('abc', 'cba').then(() => {
		t.deepEqual(logs, [
			{t: 'called', now: 1000000},
			{t: 'called', now: 1000000},
			{t: 'called', now: 1000100},
			{t: 'called', now: 1002100},
		])
	})
	clock.increase(200_000)
})

test('custom "retryAfter"', (t) => {
	t.plan(2)

	const logs = []
	const clock = createClock(() => undefined, 1000000)
	const server = createServer({
		clock,
		retryAfter: (err, attempts) => {
			if (attempts < 3) return 150
		},
		fetch: () => {
			logs.push({t: 'called', now: clock.now()})
			return Promise.reject(new Error('test'))
		},
	})
	server.tokenize('abc', 'cba').catch((err) => {
		t.equal(err.message, 'test')
		t.deepEqual(logs, [
			{t: 'called', now: 1000000}, // initial
			{t: 'called', now: 1000150}, // immediate retry
			{t: 'called', now: 1000300},
		])
	})
	clock.increase(200_000)
})

test('logging', (t) => {
	t.plan(2)

	let count = 0
	const logsA = []
	const logsB = []
	const clock = createClock(() => undefined, 1000000)
	const err = new Error('test')
	const server = createServer({
		clock,
		fetch: () => {
			if (count++ < 2) {
				return Promise.reject(err)
			} else {
				return Promise.resolve({
					status: 204,
					statusText: 'OK',
					headers: new Map([['content-type', 'application/json']]),
				})
			}
		},
		log: (l) => logsA.push(l),
	})
	const a = server.tokenize('abc', 'cba').then(() =>
		t.deepEqual(logsA, [
			{
				t: 'request',
				method: 'POST',
				url: 'https://vault.paylike.io',
				timeout: 10000,
			},
			{
				t: 'aborted',
				abort: {name: 'Error', message: 'test', stack: err.stack},
			},
			{
				t: 'request failed',
				attempts: 1,
				retryAfter: 0,
				err: {name: 'Error', message: 'test', stack: err.stack},
			},
			{
				t: 'request',
				method: 'POST',
				url: 'https://vault.paylike.io',
				timeout: 10000,
			},
			{
				t: 'response',
				status: 204,
				statusText: 'OK',
				requestId: undefined,
			},
			'closing stream',
		])
	)
	const b = server
		.tokenize('abc', 'cba', {log: (l) => logsB.push(l)})
		.then(() =>
			t.deepEqual(logsB, [
				{
					t: 'request',
					method: 'POST',
					url: 'https://vault.paylike.io',
					timeout: 10000,
				},
				{
					t: 'aborted',
					abort: {name: 'Error', message: 'test', stack: err.stack},
				},
				{
					t: 'request failed',
					attempts: 1,
					retryAfter: 0,
					err: {name: 'Error', message: 'test', stack: err.stack},
				},
				{
					t: 'request',
					method: 'POST',
					url: 'https://vault.paylike.io',
					timeout: 10000,
				},
				{
					t: 'response',
					status: 204,
					statusText: 'OK',
					requestId: undefined,
				},
				'closing stream',
			])
		)
	clock.increase(200_000)
})

test('.tokenize', (t) => {
	t.plan(3)
	const logs = []
	const server = createServer({
		request: (endpoint, {log, clock, fetch, ...opts}) => {
			t.equal(endpoint, 'vault.paylike.io')
			t.deepEqual(opts, {
				version: 1,
				data: {type: 'abc', value: 'cba'},
				timeout: 10000,
				clientId: 'js-c-1',
			})
			return {
				first: () => Promise.resolve('foo'),
			}
		},
	})
	server.tokenize('abc', 'cba').then((r) => t.equal(r, 'foo'))
})

test('.payments.create', (t) => {
	t.plan(3)
	const logs = []
	const server = createServer({
		request: (endpoint, {log, clock, fetch, ...opts}) => {
			t.equal(endpoint, 'b.paylike.io/payments')
			t.deepEqual(opts, {
				version: 1,
				data: {currency: 'YYY', amount: 999, hints: [{hintA: 'hint1'}]},
				timeout: 10000,
				clientId: 'js-c-1',
			})
			return {
				first: () => Promise.resolve('foo'),
			}
		},
	})
	server.payments
		.create({currency: 'YYY', amount: 999}, [{hintA: 'hint1'}])
		.then((r) => t.equal(r, 'foo'))
})

test('.payments.create with a challenge path', (t) => {
	t.plan(3)
	const logs = []
	const server = createServer({
		request: (endpoint, {log, clock, fetch, ...opts}) => {
			t.equal(endpoint, 'b.paylike.io/challenge-path')
			t.deepEqual(opts, {
				version: 1,
				data: {currency: 'YYY', amount: 999, hints: [{hintA: 'hint1'}]},
				timeout: 10000,
				clientId: 'js-c-1',
			})
			return {
				first: () => Promise.resolve('foo'),
			}
		},
	})
	server.payments
		.create(
			{currency: 'YYY', amount: 999},
			[{hintA: 'hint1'}],
			'/challenge-path'
		)
		.then((r) => t.equal(r, 'foo'))
})

function createClock(log = () => undefined, start = 1) {
	let now = start
	let n = 1
	const timeouts = new Set()

	return {
		now: () => now,
		setTimeout,
		clearTimeout,
		increase,
	}

	function setTimeout(fn, ms) {
		const timer = {fn, timeout: now + ms, n: n++}
		log({t: 'setTimeout', ms, n: timer.n})
		timeouts.add(timer)
		return timer
	}

	function clearTimeout(timer) {
		log({t: 'clearTimeout', n: timer.n, cleared: timeouts.has(timer)})
		timeouts.delete(timer)
	}

	function increase(ms) {
		setImmediate(() => {
			const future = now + ms
			if (
				timeouts.size === 0 ||
				[...timeouts].every(({timeout}) => timeout > future)
			) {
				now = future
			} else {
				const smallest = [...timeouts].reduce((a, b) =>
					b.timeout < a.timeout ? b : a
				)
				log({t: 'running timer', n: smallest.n})
				now = smallest.timeout
				timeouts.delete(smallest)
				smallest.fn()
				increase(future - smallest.timeout)
			}
		})
	}
}
