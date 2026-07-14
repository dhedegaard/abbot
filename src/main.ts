import * as Sentry from '@sentry/node'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { launch, TimeoutError, type ElementHandle, type HTTPRequest, type Page } from 'puppeteer'
import { env } from './env.ts'
import { clickAwaitingRequest, findVisible } from './puppeteer-helpers.ts'

// Error monitoring is opt-in: with no SENTRY_DSN the SDK stays disabled.
// sendDefaultPii stays off — this script handles login credentials and we don't
// want them attached to events.
Sentry.init({
  dsn: env.SENTRY_DSN,
  sendDefaultPii: false,
})

const doLoginFlow = async (page: Page) => {
  await page.goto('https://aarhusbolig.dk/min-side/boligsoegningsportal/boligtilbud/')

  console.log('Declining cookies')
  const declineCookies = await findVisible(
    page,
    '::-p-text(Afvis alle)',
    'the decline cookies button'
  )
  await declineCookies.click()

  console.log('Clicking login button')
  const loginButton = await findVisible(page, '::-p-text(Log ind)', 'the login button')
  await loginButton.click()

  const usernameInput = await findVisible(
    page,
    'input[placeholder="Medlemsnummer/E-mail"]',
    'the username input'
  )
  await usernameInput.type(env.USER)
  const passwordInput = await findVisible(
    page,
    'input[placeholder="Adgangskode"]',
    'the password input'
  )
  await passwordInput.type(env.PASSWORD)
  console.log('Submitting login form')
  await passwordInput.press('Enter')
  // No waitForNetworkIdle: a background XHR (ResetPassword) hangs all session, so
  // the network never idles. Callers wait on concrete elements instead.

  // Confirm the login worked: a valid login reveals the "Se boligtilbud" offers
  // link, while bad credentials keep the modal open with an "Ugyldigt login"
  // error. ("Adgang nægtet" is the resting state of the unauthenticated page, so
  // it can't serve as the failure signal.) Racing both fails fast on bad
  // credentials instead of timing out 30s later on the missing offers link.
  const offersLink = findVisible(page, '::-p-text(Se boligtilbud)', 'the offers link').then(
    (handle) => ({ ok: true as const, handle })
  )
  const invalidLogin = page
    .waitForSelector('::-p-text(Ugyldigt login)', { visible: true })
    .then(() => ({ ok: false as const, handle: null }))
  // The loser keeps waiting until its timeout; swallow that rejection so it can't
  // surface as an unhandled rejection once the race has already settled.
  offersLink.catch(() => {
    /* swallow */
  })
  invalidLogin.catch(() => {
    /* swallow */
  })
  const result = await Promise.race([offersLink, invalidLogin])
  if (!result.ok) {
    throw new Error('Login failed: invalid USER/PASSWORD (aarhusbolig reported "Ugyldigt login")')
  }
  return result.handle
}

const main = async () => {
  if (env.OUTPUT_DIR != null) {
    await mkdir(env.OUTPUT_DIR, { recursive: true })
    console.log('Ensured', env.OUTPUT_DIR, 'exists')
  } else {
    console.log('No output directory specified')
  }

  const browser = await launch({
    headless: env.HEADLESS,
    defaultViewport: { width: 1600, height: 1000 },
    // --disable-dev-shm-usage: /dev/shm is tiny in containers and crashes Chrome.
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()

  // Diagnostics: non-GET requests log on send (->), response (<-, with round-trip
  // time), and failure (xx). A "re-clicking" line with no matching `->` before it is
  // a swallowed click (AnswerOffer = decline, GetOffers = refresh).
  const startedAt = performance.now()
  const sentAt = new WeakMap<HTTPRequest, number>()
  const sinceStart = () => `+${Math.round(performance.now() - startedAt)}ms`
  page.on('request', (req) => {
    if (req.method() === 'GET') return
    sentAt.set(req, performance.now())
    console.log(`[net] -> ${req.method()} ${req.url()} at ${sinceStart()}`)
  })
  page.on('requestfailed', (req) => {
    if (req.method() === 'GET') return
    console.log(
      `[net] xx ${req.method()} ${req.url()} ${req.failure()?.errorText ?? 'failed'} at ${sinceStart()}`
    )
  })
  page.on('response', (res) => {
    const req = res.request()
    if (req.method() === 'GET') return
    const sent = sentAt.get(req)
    const took = sent == null ? '?' : `${Math.round(performance.now() - sent)}ms`
    console.log(`[net] <- ${req.method()} ${res.url()} ${res.status()} took ${took}`)
  })

  try {
    const goToOffers = await doLoginFlow(page)
    console.log('Login succeeded')
    // The click sometimes lands before Angular has bound the link's handler and
    // silently does nothing — which would end the run as a false "no offers"
    // success. Same swallowed-click hazard as clickAwaitingRequest, but verified by
    // URL change rather than a request, so it stays a separate loop.
    // Verify the SPA actually navigated and retry the click if not.
    for (let attempt = 1; ; attempt++) {
      await goToOffers.click()
      try {
        await page.waitForFunction(() => window.location.href.includes('boligtilbud'), {
          timeout: 5_000,
        })
        break
      } catch (error: unknown) {
        if (!(error instanceof TimeoutError)) throw error
        if (attempt >= 3) {
          throw new Error('Clicking the offers link never navigated to the offers page', {
            cause: error,
          })
        }
        console.log(`Offers-link click did not navigate (attempt ${attempt}), retrying`)
      }
    }
    console.log('Clicked offers link!')

    // Cap iterations so a decline that never clears the list can't loop forever.
    for (let iteration = 0; ; iteration++) {
      if (iteration >= 50) {
        throw new Error('Declined 50 offers without the list emptying; aborting runaway loop')
      }
      // Handle to the offer we decline this iteration. After refreshing we wait for
      // this exact element to detach — that's how we know the list reloaded.
      let declinedAnswer: ElementHandle
      try {
        // visible:true throws TimeoutError (never returns null); the short timeout
        // ends the loop when no offers remain.
        const answer = await page.waitForSelector('#answer', {
          visible: true,
          timeout: 10_000,
        })
        // Unreachable per the visible:true contract, but the type says null — fail
        // loudly (a plain Error, not the TimeoutError that means "no offers left").
        if (answer == null) {
          throw new Error('#answer matched but resolved null (unexpected)')
        }
        declinedAnswer = answer
        // select() silently matches nothing if the option value is gone, which
        // would later stall waiting for a confirm modal that never opens — fail
        // loudly here instead.
        const selected = await declinedAnswer.select('Decline')
        if (!selected.includes('Decline')) {
          throw new Error(
            'The #answer dropdown has no "Decline" option — aarhusbolig may have changed it'
          )
        }
        console.log('Clicked decline on first offer!')
      } catch (error: unknown) {
        if (error instanceof TimeoutError) {
          console.log('No offers to decline, quitting!')
          break
        }
        throw error
      }

      // Wait for the confirm dialog to open (network-idle never settles here).
      await page.waitForSelector('::-p-text(Du ønsker at svare nej til et tilbud)', {
        visible: true,
      })
      const acceptDeclineButton = await findVisible(
        page,
        '::-p-text(Ja, jeg bekræfter mit svar)',
        'the confirm-decline button'
      )
      // Flaky Angular click (see clickAwaitingRequest); its effect is the decline
      // POST /Umbraco/api/Offer/AnswerOffer. Awaiting the response also means the
      // modal has processed its result before we refresh.
      await clickAwaitingRequest(
        page,
        acceptDeclineButton,
        '/api/offer/answeroffer',
        'Confirm-decline'
      )
      console.log('Accepted decline!')

      const refreshOffers = await findVisible(
        page,
        '::-p-text(Aktuelle tilbud)',
        'the refresh offers button'
      )
      // "Aktuelle tilbud" fires POST /Umbraco/api/Offer/GetOffers even when already
      // active (verified live) — that refetch is the refresh signal.
      await clickAwaitingRequest(page, refreshOffers, '/api/offer/getoffers', 'Offers refresh')
      // Best-effort: the refetched list should re-render and drop the node we
      // declined. If it stays, don't fail — the next iteration re-declines it and
      // the 50-iteration cap guards a true runaway — but log it for diagnostics.
      try {
        await page.waitForFunction((el) => !el.isConnected, { timeout: 5_000 }, declinedAnswer)
      } catch (error: unknown) {
        if (!(error instanceof TimeoutError)) throw error
        console.log('[warn] declined offer still in the DOM after refetch; continuing')
      }
      console.log('Refreshed offers, running again!')
    }
    if (env.OUTPUT_DIR != null) {
      const screenshotPath = path.resolve(
        env.OUTPUT_DIR,
        `success-${new Date().toISOString().replaceAll(':', '-')}.png`
      ) as `${string}.png`
      await page.screenshot({ path: screenshotPath })
    }
    console.log('All offers declined')
  } catch (error: unknown) {
    process.exitCode = 1
    Sentry.captureException(error)
    console.error('An error occurred:', error)
    if (env.OUTPUT_DIR != null) {
      const screenshotPath = path.resolve(
        env.OUTPUT_DIR,
        `error-${new Date().toISOString().replaceAll(':', '-')}.png`
      ) as `${string}.png`
      // The page/browser is often dead by the time we're here — don't let a
      // failed screenshot mask the original error we just reported.
      try {
        await page.screenshot({ path: screenshotPath })
      } catch (screenshotError: unknown) {
        console.error('Could not capture error screenshot:', screenshotError)
      }
    }
  } finally {
    console.log('All done, closing soon!')
    if (!env.HEADLESS) {
      await new Promise((resolve) => setTimeout(resolve, 20_000))
    }
    await browser.close()
  }
}

await main().catch((error: unknown) => {
  Sentry.captureException(error)
  console.error(error)
  process.exitCode = 1
})
// Short-lived process: flush buffered events before exit or they never send.
await Sentry.flush(5_000)
