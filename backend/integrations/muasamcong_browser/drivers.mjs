export class Vue2Driver {
  name = "vue2";
  version = "2026.1";

  async performLookup(page, code, kind) {
    return page.evaluate(async ({ exactCode, lookupKind }) => {
      const runtime = document.getElementById("search-home")?.__vue__;
      if (!runtime || typeof runtime.axiosSearch !== "function") {
        throw new Error("PROCUREMENT_ADAPTER_UNSUPPORTED");
      }
      const payload = {
        pageSize: 1,
        pageNumber: 0,
        query: [{
          index: "es-contractor-selection",
          keyWord: exactCode,
          matchType: "exact",
          matchFields: ["notifyNo", "bidName"],
          filters: [{
            fieldName: "type",
            searchType: "in",
            fieldValues: [
              lookupKind === "PLAN"
                ? "es-plan-project-p"
                : "es-notify-contractor",
            ],
          }],
        }],
      };
      const result = runtime.axiosSearch(payload);
      if (result && typeof result.then === "function") await result;
      return true;
    }, { exactCode: code, lookupKind: kind });
  }
}


async function usable(locator) {
  return locator && await locator.count() > 0 && await locator.isVisible();
}


export class GenericUiDriver {
  name = "generic";
  version = "2026.1";

  async performLookup(page, code, kind) {
    const desiredCategory = kind === "PLAN"
      ? "Kế hoạch lựa chọn nhà thầu"
      : "Thông báo mời thầu";
    const categoryCandidates = page.getByRole?.("combobox");
    const category = categoryCandidates?.filter
      ? categoryCandidates.filter({
        hasText: /dự án|kế hoạch lựa chọn nhà thầu|thông báo mời thầu/i,
        visible: true,
      }).first()
      : null;
    if (await usable(category) && typeof category.innerText === "function") {
      const currentCategory = String(await category.innerText()).trim();
      if (currentCategory !== desiredCategory) {
        await category.click();
        const optionCandidates = page.getByRole(
          "option", { name: desiredCategory, exact: true },
        );
        const option = optionCandidates.filter
          ? optionCandidates.filter({ visible: true }).first()
          : optionCandidates.first();
        if (!await usable(option)) {
          throw new Error("PROCUREMENT_ADAPTER_UNSUPPORTED");
        }
        await option.click();
        const selectedCandidates = page.getByRole?.("combobox");
        const selectedCategory = selectedCandidates?.filter
          ? selectedCandidates.filter({
            hasText: desiredCategory,
            visible: true,
          }).first()
          : null;
        if (
          !await usable(selectedCategory)
          || typeof selectedCategory.innerText !== "function"
          || String(await selectedCategory.innerText()).trim() !== desiredCategory
        ) {
          throw new Error("PROCUREMENT_ADAPTER_UNSUPPORTED");
        }
      }
    }

    const exactCandidate = page.getByRole?.(
      "radio", { name: /khớp chính xác cụm từ/i },
    );
    const exactByRole = exactCandidate?.first?.();
    const exactByValue = page.locator?.(
      "input[type='radio'][value='exact']",
    )?.first?.();
    const exactRadio = await usable(exactByRole) ? exactByRole : exactByValue;
    if (await usable(exactRadio) && typeof exactRadio.check === "function") {
      await exactRadio.check();
    }

    const roleInput = page.getByRole(
      "textbox",
      { name: /tìm kiếm|tra cứu|khlcnt|lựa chọn nhà thầu|mã kế hoạch|mã thông báo/i },
    ).first();
    const labelInput = page.getByLabel?.(
      /khlcnt|lựa chọn nhà thầu|mã kế hoạch|mã thông báo/i,
    )?.first();
    const placeholderPattern = kind === "PLAN"
      ? /^nhập mã khlcnt(?:\/|\b)/i
      : /^nhập số tbmt(?:\/|\b)/i;
    const placeholderInput = page.getByPlaceholder(
      placeholderPattern,
    ).first();
    const input = await usable(roleInput)
      ? roleInput
      : await usable(placeholderInput) ? placeholderInput : labelInput;
    if (!await usable(input)) {
      throw new Error("PROCUREMENT_ADAPTER_UNSUPPORTED");
    }
    await input.fill(code);
    const searchScope = input.locator?.(
      "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' content ')][1]",
    );
    const scopedButton = searchScope?.getByRole?.(
      "button",
      { name: /^tìm kiếm$/i, exact: true },
    )?.first?.();
    const globalButton = page.getByRole(
      "button", { name: /^tìm kiếm$/i, exact: true },
    ).first();
    const button = await usable(scopedButton) ? scopedButton : globalButton;
    if (await usable(button)) await button.click();
    else await input.press("Enter");
  }
}


export class DriverRegistry {
  constructor({
    vue2Factory = () => new Vue2Driver(),
    genericFactory = () => new GenericUiDriver(),
  } = {}) {
    this.factories = new Map([
      ["vue2:2026.1", vue2Factory],
      ["generic:2026.1", genericFactory],
    ]);
  }

  select(capabilities, flags = {}) {
    const vueEnabled = flags.vue2 !== false;
    const genericEnabled = flags.generic !== false;
    if (vueEnabled && capabilities?.vue2 && capabilities?.knownRuntimeShape) {
      return this.factories.get("vue2:2026.1")();
    }
    if (genericEnabled && capabilities?.genericSearchUi) {
      return this.factories.get("generic:2026.1")();
    }
    throw new Error("PROCUREMENT_ADAPTER_UNSUPPORTED");
  }
}


const DEFAULT_DRIVER_REGISTRY = new DriverRegistry();


export function selectDriver(capabilities, flags = {}) {
  return DEFAULT_DRIVER_REGISTRY.select(capabilities, flags);
}
