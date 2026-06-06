import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { launch, TimeoutError, type Page } from 'puppeteer'
import { z } from 'zod'

const ENV = z.object({
  USER: z.string().min(1),
  PASSWORD: z.string().min(1),
  HEADLESS: z
    .enum(['1', '0'])
    .transform((value) => value === '1')
    .pipe(z.boolean()),
  OUTPUT_DIR: z
    .optional(z.string())
    .transform((value) => (value == null || value === '' ? undefined : value))
    .pipe(z.optional(z.string().min(1))),
})
interface ENV extends z.infer<typeof ENV> {}
const env: ENV = ENV.parse(process.env)

const doLoginFlow = async (page: Page) => {
  await page.goto('https://aarhusbolig.dk/min-side/boligsoegningsportal/boligtilbud/')

  console.log('Declining cookies')
  const declineCookies = await page.waitForSelector('::-p-text(Afvis alle)', { visible: true })
  if (declineCookies == null) {
    throw new Error('Could not find the decline cookies button')
  }
  await declineCookies.click()

  console.log('Clicking login button')
  const loginButton = await page.waitForSelector('::-p-text(Log ind)', { visible: true })
  if (loginButton == null) {
    throw new Error('Could not find the login button')
  }
  await loginButton.click()

  const usernameInput = await page.waitForSelector('input[placeholder="Medlemsnummer/E-mail"]', {
    visible: true,
  })
  if (usernameInput == null) {
    throw new Error('Could not find the username input')
  }
  await usernameInput.type(env.USER)
  const passwordInput = await page.waitForSelector('input[placeholder="Adgangskode"]', {
    visible: true,
  })
  if (passwordInput == null) {
    throw new Error('Could not find the password input')
  }
  await passwordInput.type(env.PASSWORD)
  console.log('Submitting login form')
  await passwordInput.press('Enter')
  // No waitForNetworkIdle: a background XHR (ResetPassword) hangs all session, so
  // the network never idles. Callers wait on concrete elements instead.
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
  try {
    await doLoginFlow(page)
    console.log('Login succeeded')

    const goToOffers = await page.waitForSelector('::-p-text(Se boligtilbud)', { visible: true })
    if (goToOffers == null) {
      throw new Error('Could not find the offers link')
    }
    await goToOffers.click()
    console.log('Clicked offers link!')

    // Cap iterations so a decline that never clears the list can't loop forever.
    for (let iteration = 0; ; iteration++) {
      if (iteration >= 50) {
        throw new Error('Declined 50 offers without the list emptying; aborting runaway loop')
      }
      try {
        // visible:true throws TimeoutError (never returns null); the short timeout
        // ends the loop when no offers remain.
        const firstAnswer = await page.waitForSelector('#answer', {
          visible: true,
          timeout: 10_000,
        })
        await firstAnswer!.select('Decline')
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
      const acceptDeclineButton = await page.waitForSelector(
        '::-p-text(Ja, jeg bekræfter mit svar)',
        { visible: true }
      )
      if (acceptDeclineButton == null) {
        throw new Error('Could not find the confirm-decline button')
      }
      await acceptDeclineButton.click()
      console.log('Accepted decline!')

      // Decline is done when the modal closes. "Aktuelle tilbud" is a persistent
      // tab that matches instantly, so key off the confirm button disappearing.
      await page.waitForSelector('::-p-text(Ja, jeg bekræfter mit svar)', { hidden: true })

      const refreshOffers = await page.waitForSelector('::-p-text(Aktuelle tilbud)', {
        visible: true,
      })
      if (refreshOffers == null) {
        throw new Error('Could not find the refresh offers button')
      }
      // Wait for the refetch (registered before the click) so the next iteration
      // sees the refreshed list, not the stale declined offer.
      const offersRefetched = page.waitForResponse((res) =>
        res.url().includes('/MyOffers/GetMyOffers')
      )
      await refreshOffers.click()
      await offersRefetched
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
    console.error(error)
    if (env.OUTPUT_DIR != null) {
      const screenshotPath = path.resolve(
        env.OUTPUT_DIR,
        `error-${new Date().toISOString().replaceAll(':', '-')}.png`
      ) as `${string}.png`
      await page.screenshot({ path: screenshotPath })
    }
    console.error(`An error occurred: ${String(error)}`)
  } finally {
    console.log('All done, closing soon!')
    if (!env.HEADLESS) {
      await new Promise((resolve) => setTimeout(resolve, 20_000))
    }
    await browser.close()
  }
}

await main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
