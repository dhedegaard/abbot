import { TimeoutError, type ElementHandle, type HTTPRequest, type Page } from 'puppeteer'

// Wait for a visible element and fail with a clear message if it never appears.
// visible:true throws TimeoutError (never returns null), so rethrow it as a
// readable error naming the step and selector — the usual cause is aarhusbolig
// changing the Danish copy these text selectors match.
export const findVisible = async (page: Page, selector: string, description: string) => {
  try {
    return (await page.waitForSelector(selector, { visible: true }))!
  } catch (error: unknown) {
    if (error instanceof TimeoutError) {
      throw new Error(`Could not find ${description} (selector: ${selector})`, { cause: error })
    }
    throw error
  }
}

// Click an Angular element that may swallow the click (handler not bound yet).
// Retry until the click fires `urlFragment`, keying off the request being *sent*,
// not its response, so a slow round-trip can't look swallowed and double-submit.
// Once sent, a missing/slow response or non-2xx is the site's fault — throw.
export const clickAwaitingRequest = async (
  page: Page,
  button: ElementHandle,
  urlFragment: string,
  description: string
) => {
  const timeout = 20_000
  for (let attempt = 1; ; attempt++) {
    const requestSent = page.waitForRequest(
      (req) => req.url().toLowerCase().includes(urlFragment),
      {
        timeout,
      }
    )
    // Swallow the timeout if the click throws before we await it.
    requestSent.catch(() => {})
    await button.click()

    let request: HTTPRequest
    try {
      request = await requestSent
    } catch (error: unknown) {
      if (!(error instanceof TimeoutError)) throw error
      if (attempt >= 2) {
        throw new Error(
          `${description}: click fired no ${urlFragment} request after ${attempt} attempts (Angular swallowed it)`,
          { cause: error }
        )
      }
      console.log(`${description}: click fired no request (attempt ${attempt}), re-clicking`)
      continue
    }

    // Click landed. Await its response (guard the race where it already arrived);
    // a timeout now is a hung site, not a swallowed click.
    let response = request.response()
    if (response == null) {
      try {
        response = await page.waitForResponse((res) => res.request() === request, { timeout })
      } catch (error: unknown) {
        if (error instanceof TimeoutError) {
          throw new Error(
            `${description}: request sent but no response within 20s (slow/hung site?)`,
            {
              cause: error,
            }
          )
        }
        throw error
      }
    }
    if (!response.ok()) {
      throw new Error(`${description}: request returned HTTP ${response.status()}`)
    }
    return response
  }
}
