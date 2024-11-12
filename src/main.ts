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
    .optional(z.string().min(1))
    .transform((value) => (value == null || value.length === 0 ? './output' : value))
    .pipe(z.string().min(1)),
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
  await page.waitForNetworkIdle()
}

const main = async () => {
  await mkdir(env.OUTPUT_DIR, { recursive: true })
  console.log('Ensured', env.OUTPUT_DIR, 'exists')

  const browser = await launch({
    headless: env.HEADLESS,
    defaultViewport: { width: 1600, height: 1000 },
    args: ['--no-sandbox'],
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
    await page.waitForNetworkIdle()
    console.log('Clicked offers link!')

    for (;;) {
      try {
        const firstAnswer = await page.waitForSelector('#answer', { visible: true })
        if (firstAnswer == null) {
          console.log('No offers to decline, quitting!')
          break
        }
        await firstAnswer.select('Decline')
        console.log('Clicked decline on first offer!')
      } catch (error: unknown) {
        if (error instanceof TimeoutError) {
          console.log('No offers to decline, quitting!')
          break
        }
        throw error
      }

      // Make sure we're asked to confirm a decline before accepting.
      await page.waitForNetworkIdle()
      await page.waitForSelector('::-p-text(Du ønsker at svare nej til et tilbud)', {
        visible: true,
      })
      const acceptDeclineButton = await page.waitForSelector(
        '::-p-text(Ja, jeg accepterer at mit svar er bindende)',
        { visible: true }
      )
      await acceptDeclineButton?.click()
      console.log('Accepted decline!')

      await page.waitForNetworkIdle()
      const refreshOffers = await page.waitForSelector('::-p-text(Aktuelle tilbud)', {
        visible: true,
      })
      if (refreshOffers == null) {
        throw new Error('Could not find the refresh offers button')
      }
      await refreshOffers.click()
      await page.waitForNetworkIdle()
      console.log('Refreshed offers, running again!')
    }
    const screenshotPath = path.resolve(
      env.OUTPUT_DIR,
      `success-${new Date().toISOString().replaceAll(':', '-')}.png`
    )
    await page.screenshot({ path: screenshotPath })
    console.log('All offers declined, screenshot saved to', screenshotPath)
  } catch (error: unknown) {
    console.error(error)
    const screenshotPath = path.resolve(
      env.OUTPUT_DIR,
      `error-${new Date().toISOString().replaceAll(':', '-')}.png`
    )
    await page.screenshot({ path: screenshotPath })
    console.error('An error occurred, screenshot saved to', screenshotPath)
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
