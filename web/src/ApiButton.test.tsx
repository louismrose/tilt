import { Button, Icon, TextField } from "@material-ui/core"
import { mount } from "enzyme"
import fetchMock from "fetch-mock"
import { SnackbarProvider } from "notistack"
import React from "react"
import { act } from "react-dom/test-utils"
import { MemoryRouter } from "react-router"
import { AnalyticsAction } from "./analytics"
import {
  cleanupMockAnalyticsCalls,
  expectIncrs,
  mockAnalyticsCalls,
} from "./analytics_test_helpers"
import {
  ApiButton,
  ApiButtonForm,
  ApiButtonInputsToggleButton,
  ApiButtonLabel,
} from "./ApiButton"
import {
  boolField,
  hiddenField,
  makeUIButton,
  textField,
} from "./ApiButton.testhelpers"
import { HudErrorContextProvider } from "./HudErrorContext"
import { accessorsForTesting, tiltfileKeyContext } from "./LocalStorage"
import { flushPromises } from "./promise"

type UIButtonStatus = Proto.v1alpha1UIButtonStatus
type UIButton = Proto.v1alpha1UIButton

const buttonInputsAccessor = accessorsForTesting(`apibutton-TestButton`)

function wrappedMount(e: JSX.Element) {
  return mount(
    <MemoryRouter>
      <tiltfileKeyContext.Provider value="test">
        <SnackbarProvider>{e}</SnackbarProvider>
      </tiltfileKeyContext.Provider>
    </MemoryRouter>
  )
}

function mountButton(b: UIButton) {
  return wrappedMount(<ApiButton uiButton={b} />)
}

describe("ApiButton", () => {
  beforeEach(() => {
    localStorage.clear()
    fetchMock.reset()
    mockAnalyticsCalls()
    fetchMock.mock(
      (url) => url.startsWith("/proxy/apis/tilt.dev/v1alpha1/uibuttons"),
      JSON.stringify({})
    )
    Date.now = jest.fn(() => 1482363367071)
  })

  afterEach(() => {
    localStorage.clear()
    cleanupMockAnalyticsCalls()
  })

  it("renders a simple button", () => {
    const b = makeUIButton()
    const root = mountButton(b)
    const button = root.find(ApiButton).find("button")
    expect(button.length).toEqual(1)
    expect(button.find(Icon).text()).toEqual(b.spec!.iconName)
    expect(button.find(ApiButtonLabel).text()).toEqual(b.spec!.text)
  })

  it("sends analytics", async () => {
    const b = makeUIButton()
    const root = mountButton(b)
    const button = root.find(ApiButton).find("button")
    await click(button)
    expectIncrs({
      name: "ui.web.uibutton",
      tags: { action: AnalyticsAction.Click, component: "Global" },
    })
  })

  it("renders an options button when the button has inputs", () => {
    const inputs = [1, 2, 3].map((i) => textField(`text${i}`))
    const root = mountButton(makeUIButton({ inputSpecs: inputs }))
    expect(
      root.find(ApiButton).find(ApiButtonInputsToggleButton).length
    ).toEqual(1)
  })

  it("doesn't render an options button when the button has only hidden inputs", () => {
    const inputs = [1, 2, 3].map((i) => hiddenField(`hidden${i}`, `value${i}`))
    const root = mountButton(makeUIButton({ inputSpecs: inputs }))
    expect(
      root.find(ApiButton).find(ApiButtonInputsToggleButton).length
    ).toEqual(0)
  })

  it("shows the options form when the options button is clicked", async () => {
    const inputs = [1, 2, 3].map((i) => textField(`text${i}`))
    const root = mountButton(makeUIButton({ inputSpecs: inputs }))

    const optionsButton = root.find(ApiButtonInputsToggleButton)
    await click(optionsButton)
    root.update()

    const optionsForm = root.find(ApiButtonForm)
    expect(optionsForm.length).toEqual(1)

    const expectedInputNames = inputs.map((i) => i.label)
    const actualInputNames = optionsForm
      .find(TextField)
      .map((i) => i.prop("label"))
    expect(actualInputNames).toEqual(expectedInputNames)
  })

  it("allows an empty text string when there's a default value", async () => {
    const input = textField("text1", "default_text")
    const root = mountButton(makeUIButton({ inputSpecs: [input] }))

    const optionsButton = root.find(ApiButtonInputsToggleButton)
    await click(optionsButton)
    root.update()

    const tf = root.find(ApiButtonForm).find("input#text1")
    tf.simulate("change", { target: { value: "" } })

    expect(root.find(ApiButtonForm).find(TextField).prop("value")).toEqual("")
  })

  it("propagates analytics tags to text inputs", async () => {
    const input = boolField("bool1")
    const root = mountButton(makeUIButton({ inputSpecs: [input] }))

    const optionsButton = root.find(ApiButtonInputsToggleButton)
    await click(optionsButton)
    root.update()

    const tf = root.find(ApiButtonForm).find("input#bool1")
    tf.simulate("change", { target: { value: true } })

    expectIncrs(
      {
        name: "ui.web.uibutton.inputMenu",
        tags: { action: AnalyticsAction.Click, component: "Global" },
      },
      {
        name: "ui.web.uibutton.inputValue",
        tags: {
          action: AnalyticsAction.Edit,
          component: "Global",
          inputType: "bool",
        },
      }
    )
  })

  it("submits the current options when the submit button is clicked", async () => {
    const inputSpecs = [
      textField("text1"),
      boolField("bool1"),
      hiddenField("hidden1", "hidden value 1"),
    ]
    const root = mountButton(makeUIButton({ inputSpecs: inputSpecs }))

    const optionsButton = root.find(ApiButtonInputsToggleButton)
    await click(optionsButton)
    root.update()

    const tf = root.find(ApiButtonForm).find("input#text1")
    tf.simulate("change", { target: { value: "new_value" } })
    const bf = root.find(ApiButtonForm).find("input#bool1")
    bf.simulate("change", { target: { checked: true } })
    root.update()

    const submit = root.find(ApiButton).find(Button).at(0)
    await click(submit)
    root.update()

    const calls = fetchMock
      .calls()
      .filter((c) => c[0] !== "http://localhost/api/analytics")
    expect(calls.length).toEqual(1)
    const call = calls[0]
    expect(call[0]).toEqual(
      "/proxy/apis/tilt.dev/v1alpha1/uibuttons/TestButton/status"
    )
    expect(call[1]).toBeTruthy()
    expect(call[1]!.method).toEqual("PUT")
    expect(call[1]!.body).toBeTruthy()
    const actualStatus: UIButtonStatus = JSON.parse(
      call[1]!.body!.toString()
    ).status

    const expectedStatus: UIButtonStatus = {
      lastClickedAt: "2016-12-21T23:36:07.071000+00:00",
      inputs: [
        {
          name: "text1",
          text: {
            value: "new_value",
          },
        },
        {
          name: "bool1",
          bool: {
            value: true,
          },
        },
        {
          name: "hidden1",
          hidden: {
            value: "hidden value 1",
          },
        },
      ],
    }
    expect(actualStatus).toEqual(expectedStatus)
  })

  it("submits default options when the submit button is clicked", async () => {
    const inputSpecs = [
      textField("text1", "default_text"),
      boolField("bool1", true),
      hiddenField("hidden1", "hidden value 1"),
    ]
    const root = mountButton(makeUIButton({ inputSpecs: inputSpecs }))

    const submit = root.find(ApiButton).find(Button).at(0)
    await click(submit)
    root.update()

    const calls = fetchMock
      .calls()
      .filter((c) => c[0] !== "http://localhost/api/analytics")
    expect(calls.length).toEqual(1)
    const call = calls[0]
    expect(call[0]).toEqual(
      "/proxy/apis/tilt.dev/v1alpha1/uibuttons/TestButton/status"
    )
    expect(call[1]).toBeTruthy()
    expect(call[1]!.method).toEqual("PUT")
    expect(call[1]!.body).toBeTruthy()
    const actualStatus: UIButtonStatus = JSON.parse(
      call[1]!.body!.toString()
    ).status

    const expectedStatus: UIButtonStatus = {
      lastClickedAt: "2016-12-21T23:36:07.071000+00:00",
      inputs: [
        {
          name: "text1",
          text: {
            value: "default_text",
          },
        },
        {
          name: "bool1",
          bool: {
            value: true,
          },
        },
        {
          name: "hidden1",
          hidden: {
            value: "hidden value 1",
          },
        },
      ],
    }
    expect(actualStatus).toEqual(expectedStatus)
  })

  it("reads options from local storage", async () => {
    buttonInputsAccessor.set({
      text1: "text value",
      bool1: true,
    })
    const inputSpecs = [textField("text1"), boolField("bool1")]
    const root = mountButton(makeUIButton({ inputSpecs: inputSpecs }))

    const optionsButton = root.find(ApiButtonInputsToggleButton)
    await click(optionsButton)
    root.update()

    const tf = root.find(ApiButtonForm).find("input#text1")
    expect(tf.props().value).toEqual("text value")
    const bf = root.find(ApiButtonForm).find("input#bool1")
    expect(bf.props().checked).toEqual(true)
  })

  it("writes options to local storage", async () => {
    const inputSpecs = [textField("text1"), boolField("bool1")]
    const root = mountButton(makeUIButton({ inputSpecs: inputSpecs }))

    const optionsButton = root.find(ApiButtonInputsToggleButton)
    await click(optionsButton)
    root.update()

    const tf = root.find(ApiButtonForm).find("input#text1")
    tf.simulate("change", { target: { value: "new_value" } })
    const bf = root.find(ApiButtonForm).find("input#bool1")
    bf.simulate("change", { target: { checked: true } })

    expect(buttonInputsAccessor.get()).toEqual({
      text1: "new_value",
      bool1: true,
    })
  })

  it("sets a hud error when the api request fails", async () => {
    let error: string | undefined
    const setError = (e: string) => {
      error = e
    }
    const root = wrappedMount(
      <HudErrorContextProvider setError={setError}>
        <ApiButton uiButton={makeUIButton()} />
      </HudErrorContextProvider>
    )

    fetchMock.reset()
    mockAnalyticsCalls()
    fetchMock.put(
      (url) => url.startsWith("/proxy/apis/tilt.dev/v1alpha1/uibuttons"),
      { throws: "broken!" }
    )

    const submit = root.find(ApiButton).find(Button).at(0)
    await click(submit)
    root.update()

    expect(error).toEqual("Error submitting button click: broken!")
  })
})

async function click(button: any) {
  await act(async () => {
    button.simulate("click")
    // the button's onclick updates the button so we need to wait for that to resolve
    // within the act() before continuing
    // some related info: https://github.com/testing-library/react-testing-library/issues/281
    await flushPromises()
  })
}
