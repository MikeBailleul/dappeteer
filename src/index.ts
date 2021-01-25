import * as path from "path";
import * as puppeteer from "Puppeteer";

const timeout = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export type LaunchOptions = puppeteer.LaunchOptions & {
  metamaskVersion?: string;
  metamaskPath?: string;
};

function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

export type MetamaskOptions = {
  seed?: string;
  password?: string;
  extensionId?: string;
  extensionUrl?: string;
};

export type Dappeteer = {
  lock: () => Promise<void>;
  unlock: (password: string) => Promise<void>;
  addNetwork: (url: string) => Promise<void>;
  importPK: (pk: string) => Promise<void>;
  switchAccount: (accountNumber: number) => Promise<void>;
  switchNetwork: (network: string) => Promise<void>;
  confirmTransaction: (options: TransactionOptions) => Promise<void>;
  sign: () => Promise<void>;
  approve: () => Promise<void>;
  connect: () => Promise<void>;
  connectWithSignature: () => Promise<void>;
};

export type TransactionOptions = {
  gas: number;
  gasLimit: number;
};

export async function launch(
  puppeteer,
  options: LaunchOptions = {}
): Promise<puppeteer.Browser> {
  const { args, ...rest } = options;

  const { metamaskVersion, metamaskPath } = options;
  const METAMASK_VERSION = metamaskVersion || "8.1.11";
  console["log"](path.join(__dirname, `metamask/${METAMASK_VERSION}`));
  const METAMASK_PATH =
    metamaskPath || path.resolve(__dirname, "..", "metamask", METAMASK_VERSION);
  console.log(METAMASK_PATH);

  return puppeteer.launch({
    headless: false,
    args: [
      `--disable-extensions-except=${METAMASK_PATH}`,
      `--load-extension=${METAMASK_PATH}`,
      `--user-agent=PuppeteerAgent`,
      ...(args || []),
    ],
    ...rest,
  });
}

export async function getMetamask(
  browser: puppeteer.Browser,
  options: MetamaskOptions = {}
): Promise<Dappeteer> {
  const metamaskPage = await closeHomeScreen(browser);
  await confirmWelcomeScreen(metamaskPage);

  await importAccount(
    metamaskPage,
    options.seed ||
      "already turtle birth enroll since owner keep patch skirt drift any dinner",
    options.password || "password1234"
  );

  let signedIn = true;

  await metamaskPage.close()

  return {
    lock: async () => {
      if (!signedIn) {
        throw new Error("You can't sign out because you haven't signed in yet");
      }
      await metamaskPage.bringToFront();
      const accountSwitcher = await metamaskPage.waitForSelector(".identicon");
      await accountSwitcher.click();
      const signoutButton = await metamaskPage.waitForSelector(
        ".account-menu__logout-button"
      );
      await signoutButton.click();
      await waitForSignInScreen(metamaskPage);
      signedIn = false;
    },

    connect: async () => {
      await attemptToConnect(browser, options);
    },

    connectWithSignature: async () => {
      await attemptToConnect(browser, options);
      await attemptToSign(browser, options);
    },

    unlock: async (password = "password1234") => {
      if (signedIn) {
        throw new Error("You can't sign in because you are already signed in");
      }
      await metamaskPage.bringToFront();
      const passwordBox = await metamaskPage.waitForSelector("#password");
      await passwordBox.type(password);
      const login = await metamaskPage.waitForSelector(".unlock-page button");
      await login.click();
      await waitForUnlockedScreen(metamaskPage);
      signedIn = true;
    },

    addNetwork: async (url) => {
      await metamaskPage.bringToFront();
      const networkSwitcher = await metamaskPage.waitForSelector(".network-indicator");
      await networkSwitcher.click();
      await metamaskPage.waitForSelector("li.dropdown-menu-item");
      const networkIndex = await metamaskPage.evaluate((network) => {
        const elements = document.querySelectorAll("li.dropdown-menu-item");
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          if (
            (element as HTMLLIElement).innerText
              .toLowerCase()
              .includes(network.toLowerCase())
          ) {
            return i;
          }
        }
        return elements.length - 1;
      }, "Custom RPC");
      const networkButton = (await metamaskPage.$$("li.dropdown-menu-item"))[
        networkIndex
      ];
      await networkButton.click();
      const newRPCInput = await metamaskPage.waitForSelector("input#new-rpc");
      await newRPCInput.type(url);
      const saveButton = await metamaskPage.waitForSelector(
        "button.settings-tab__rpc-save-button"
      );
      await saveButton.click();
      const prevButton = await metamaskPage.waitForSelector(
        "img.app-header__metafox-logo"
      );
      await prevButton.click();
      await waitForUnlockedScreen(metamaskPage);
    },

    importPK: async (pk) => {
      await metamaskPage.bringToFront();
      const accountSwitcher = await metamaskPage.waitForSelector(".identicon");
      await accountSwitcher.click();
      const addAccount = await metamaskPage.waitForSelector(
        ".account-menu > div:nth-child(7)"
      );
      await addAccount.click();
      const PKInput = await metamaskPage.waitForSelector("input#private-key-box");
      await PKInput.type(pk);
      const importButton = await metamaskPage.waitForSelector("button.btn-secondary");
      await importButton.click();
      await waitForUnlockedScreen(metamaskPage);
    },

    switchAccount: async (accountNumber) => {
      await metamaskPage.bringToFront();
      const accountSwitcher = await metamaskPage.waitForSelector(".identicon");
      await accountSwitcher.click();
      const account = await metamaskPage.waitForSelector(
        `.account-menu__accounts > div:nth-child(${accountNumber})`
      );
      await account.click();
      await waitForUnlockedScreen(metamaskPage);
    },

    switchNetwork: async (network = "main") => {
      await metamaskPage.bringToFront();
      const networkSwitcher = await metamaskPage.waitForSelector(".network-indicator");
      await networkSwitcher.click();
      await metamaskPage.waitForSelector("li.dropdown-menu-item");
      const networkIndex = await metamaskPage.evaluate((network) => {
        const elements = document.querySelectorAll("li.dropdown-menu-item");
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          if (
            (element as HTMLLIElement).innerText
              .toLowerCase()
              .includes(network.toLowerCase())
          ) {
            return i;
          }
        }
        return 0;
      }, network);
      const networkButton = (await metamaskPage.$$("li.dropdown-menu-item"))[
        networkIndex
      ];
      await networkButton.click();
      await waitForEthereum(metamaskPage);
    },

    confirmTransaction: async (options) => {
      await metamaskPage.bringToFront();
      if (!signedIn) {
        throw new Error("You haven't signed in yet");
      }

      await metamaskPage.waitForSelector(
        ".transaction-list__pending-transactions .transaction-list-item .transaction-status--unapproved"
      );
      await metamaskPage.reload();

      if (options) {
        const editButtonSelector = "div.confirm-detail-row__header-text--edit";
        const editButton = await metamaskPage.waitForSelector(editButtonSelector);
        await editButton.click();

        const tabSelector = "li.page-container__tab:nth-child(2)";
        const tab = await metamaskPage.waitForSelector(tabSelector);
        await tab.click();

        if (options.gas) {
          const gasSelector =
            ".advanced-gas-inputs__gas-edit-row:nth-child(1) input";
          const gas = await metamaskPage.waitForSelector(gasSelector);

          await metamaskPage.evaluate(
            () =>
              ((document.querySelectorAll(
                ".advanced-gas-inputs__gas-edit-row:nth-child(1) input"
              )[0] as HTMLInputElement).value = "")
          );
          await gas.type(options.gas.toString());
        }

        if (options.gasLimit) {
          const gasLimitSelector =
            ".advanced-gas-inputs__gas-edit-row:nth-child(2) input";
          const gasLimit = await metamaskPage.waitForSelector(gasLimitSelector);

          await metamaskPage.evaluate(
            () =>
              ((document.querySelectorAll(
                ".advanced-gas-inputs__gas-edit-row:nth-child(2) input"
              )[0] as HTMLInputElement).value = "")
          );
          await gasLimit.type(options.gasLimit.toString());
        }

        const saveSelector =
          "#app-content > div > span > div.modal > div > div > div > div.page-container__bottom > div.page-container__footer > header > button";
        const saveButton = await metamaskPage.waitForSelector(saveSelector);
        await saveButton.click();

        //Wait for modal to disappear
        await metamaskPage.waitForFunction(() => !document.querySelector("div.modal"));
      }
      const confirmButtonSelector =
        "#app-content > div > div.main-container-wrapper > div > div.page-container__footer > header > button.button.btn-primary.btn--large.page-container__footer-button";
      const confirmButton = await metamaskPage.waitForSelector(confirmButtonSelector);
      await confirmButton.click();
      await waitForUnlockedScreen(metamaskPage);
    },

    sign: async () => {
      if (!signedIn) {
        throw new Error("You haven't signed in yet");
      }

      await attemptToSign(browser, options)
    },

    approve: async () => {
      await metamaskPage.bringToFront();

      const confirmButtonSelector =
        "button.button.btn-primary.btn--large.page-container__footer-button";

      const button = await metamaskPage.waitForSelector(confirmButtonSelector);
      await button.click();

      await waitForUnlockedScreen(metamaskPage);
    },
  };
}

async function closeHomeScreen(
  browser: puppeteer.Browser
): Promise<puppeteer.Page> {
  return new Promise((resolve, reject) => {
    browser.on("targetcreated", async (target) => {
      if (target.url().match("chrome-extension://[a-z]+/home.html")) {
        try {
          const page = await target.page();
          resolve(page);
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

async function goToMetamaskPopup(browser, extensionId, extensionUrl) {
  return goToMetamaskWebPage(browser, extensionId, extensionUrl, 'popup');
}

async function goToMetamaskNotification(browser, extensionId, extensionUrl) {
  return goToMetamaskWebPage(browser, extensionId, extensionUrl, 'notification');
}

async function goToMetamaskWebPage(browser, extensionId, extensionUrl, htmlPage) {
  const EXTENSION_ID = extensionId || "nkbihfbeogaeaoehlefnkodbefgpgknn";
  const EXTENSION_URL =
      extensionUrl || `chrome-extension://${EXTENSION_ID}/${htmlPage}.html`;

  const metamaskPage = await browser.newPage();
  await metamaskPage.goto(EXTENSION_URL);
  return metamaskPage;
}

async function confirmWelcomeScreen(metamaskPage: puppeteer.Page) {
  const continueButton = await metamaskPage.waitForSelector(".welcome-page button");
  await continueButton.click();
}

async function importAccount(
  metamaskPage: puppeteer.Page,
  seed: string,
  password: string
) {
  const importLink = await metamaskPage.waitForSelector(".first-time-flow button");
  await importLink.click();

  const metricsOptOut = await metamaskPage.waitForSelector(
    ".metametrics-opt-in button.btn-primary"
  );
  await metricsOptOut.click();

  const seedPhraseInput = await metamaskPage.waitForSelector(".MuiInputBase-input");
  //class="MuiInputBase-input MuiInput-input"
  await seedPhraseInput.type(seed);

  const passwordInput = await metamaskPage.waitForSelector("#password");
  await passwordInput.type(password);

  const passwordConfirmInput = await metamaskPage.waitForSelector("#confirm-password");
  await passwordConfirmInput.type(password);

  const acceptTerms = await metamaskPage.waitForSelector(".first-time-flow__terms");
  await acceptTerms.click();

  const restoreButton = await metamaskPage.waitForSelector(".first-time-flow button");
  await restoreButton.click();

  const doneButton = await metamaskPage.waitForSelector(".end-of-flow button");
  await doneButton.click();
}

async function attemptToConnect(browser, options) {
  await delay(2500)

  const popup = await goToMetamaskPopup(browser, options.extensionId, options.extensionUrl)
  await popup.bringToFront();

  try {
    const nextButton = await popup.waitForSelector(".btn-primary", { timeout: 4000 });
    await nextButton.click();

    const connectButton = await popup.waitForSelector(".btn-primary", { timeout: 4000 });
    await connectButton.click();
  } catch {
    console.warn('Connect button not found, probably already connected?')
  } finally {
    await popup.close();
  }
}

async function attemptToSign(browser, options) {
  await delay(2500)

  const popup = await goToMetamaskPopup(browser, options.extensionId, options.extensionUrl)
  await popup.bringToFront();

  try {
    const signButton = await popup.waitForSelector(".btn-secondary", { timeout: 4000 });
    await signButton.click();
  } catch (e) {
    console.error(e)
  } finally {
    await popup.close();
  }
}

async function waitForUnlockedScreen(metamaskPage) {
  await metamaskPage.waitForSelector(".main-container-wrapper");
}

async function waitForSignInScreen(metamaskPage) {
  await metamaskPage.waitForSelector("#metamask-mascot-container");
}

async function waitForEthereum(metamaskPage) {
  await Promise.race([
    waitUntilStartConnectingToEthereum(metamaskPage),
    timeout(1),
  ]);
  return Promise.race([
    waitUntilConnectedToEthereum(metamaskPage),
    timeout(10),
  ]);
}

async function waitUntilStartConnectingToEthereum(metamaskPage) {
  await metamaskPage.waitForSelector(() => {
    return !!document.querySelector('img[src="images/loading.svg"]');
  });
}

async function waitUntilConnectedToEthereum(metamaskPage) {
  await metamaskPage.waitForSelector(() => {
    return document.querySelector('img[src="images/loading.svg"]') == null;
  });
}
