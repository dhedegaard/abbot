import { launch, type Page } from 'puppeteer'
import { z } from 'zod'

const ENV = z.object({
  USER: z.string().min(1),
  PASSWORD: z.string().min(1),
})
interface ENV extends z.infer<typeof ENV> {}
const env: ENV = ENV.parse(process.env)

const doLoginFlow = async (page: Page) => {
  await page.goto('https://aarhusbolig.dk/min-side/boligsoegningsportal/boligtilbud/')

  const declineCookies = await page.waitForSelector('::-p-text(Afvis alle)', { visible: true })
  if (declineCookies == null) {
    throw new Error('Could not find the decline cookies button')
  }
  await declineCookies.click()

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
  await passwordInput.press('Enter')
}

const main = async () => {
  const browser = await launch({ headless: false, defaultViewport: { width: 1600, height: 1000 } })
  try {
    const page = await browser.newPage()
    await doLoginFlow(page)
    await page.waitForNetworkIdle()
    console.log('POST LOGIN!')

    const goToOffers = await page.waitForSelector('::-p-text(Se boligtilbud)', { visible: true })
    await goToOffers?.click()
    await page.waitForNetworkIdle()
    console.log('Clicked offers link!')

    for (;;) {
      const firstAnswer = await page.waitForSelector('#answer', { visible: true })
      await firstAnswer?.select('Decline')
      console.log('Clicked decline on first offer!')

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
      await refreshOffers?.click()
      await page.waitForNetworkIdle()
      console.log('Refreshed offers, running again!')
    }
  } finally {
    // await browser.close()
  }
}

await main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
