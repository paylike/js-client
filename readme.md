# Paylike API client

_This is an ALPHA release_

Although the functionality included is production quality, the supported scope
of the API is merely a stub.

High-level client for the API documented at:
https://github.com/paylike/api-reference. It is using
[paylike/request](https://www.npmjs.com/package/@paylike/request) under the
hood.

## Installation

```sh
npm install @paylike/client
```

```js
// Node.js CJS-style (or anywhere without "fetch")
// npm install node-fetch@2
const fetch = require('node-fetch')
const paylike = require('@paylike/client')({fetch})

// Node.js ESM-style (or anywhere without "fetch")
import Paylike from '@paylike/client'
import fetch from 'node-fetch'
const paylike = Paylike({fetch})

// Browser environment ("fetch" is "window.fetch")
import Paylike from '@paylike/client'
const paylike = Paylike()
```

## Methods

```js
.tokenize(type, value[, opts])
// → Promise<Token>
```

```js
.payments.create(payment, hints, challengePath[, opts])
// → Promise<Token>
```

## Error handling

The methods may throw any error forwarded from the used fetch implementation as
well as one of the below error classes. All error classes are exposed on the
main function.

```js
const paylike = require('@paylike/client')()
paylike.RateLimitError
```

- `RateLimitError`

  May have a `retryAfter` (milliseconds) property if sent by the server
  specifying the minimum delay.

- `TimeoutError`

  Has a `timeout` (milliseconds) property specifying the time waited.

- `ServerError`

  Has `status` and `headers` properties copied from the fetch response.

- `ResponseError`

  These errors correspond to
  [status codes](https://github.com/paylike/api-reference/blob/master/status-codes.md)
  from the API reference. They have at least a `code` and `message` property,
  but may also have other useful properties relevant to the specific error code,
  such as a minimum and maximum for amounts.

## Logging

Pass a log function of the format `(i) => {}` to catch internal (structured)
logging.

```js
const paylike = require('@paylike/client')({log: console.log})
```

## Timeouts and retries

There is a default timeout for all HTTPS requests of 10 seconds and a retry
strategy of 10 retries with increasing delay (check the source for details). The
default maximum timeout (retries and timeouts accumulated) is 72,100
milliseconds.

Both of these parameters can be customized:

```js
const paylike = require('@paylike/client')({
  timeout: 10000,
  retryAfter: (err, attempts) => {
    // err = current error
    // attempts = total attempts so far
    return false // no more attempts (err will be returned to the client)
    // or
    return 1000 // retry after this many milliseconds
  },
})
```

Both options can be set on the factory or the individual method.
