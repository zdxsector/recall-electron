import AppKit
import Combine
import SwiftUI

public typealias RecallNativeSettingsChangeCallback = @convention(c) (
  UnsafePointer<CChar>?,
  UnsafePointer<CChar>?,
  UnsafePointer<CChar>?,
  UInt8,
  UInt8,
  UInt8,
  UInt8
) -> Void

private var changeCallback: RecallNativeSettingsChangeCallback?
private var settingsWindowController: RecallSettingsWindowController?

private struct RecallSettingsState: Equatable {
  var noteDisplay = "comfy"
  var lineLength = "narrow"
  var fontSize = "normal"
  var sortType = "modificationDate"
  var sortReversed = false
  var theme = "system"
  var keyboardShortcuts = true
  var sendNotifications = false
  var lockedNotesPasswordMode = "login"
  var lockedNotesUseTouchId = true
}

private func string(from value: UnsafePointer<CChar>?, fallback: String) -> String {
  guard let value else {
    return fallback
  }

  return String(cString: value)
}

private func makeState(
  noteDisplay: UnsafePointer<CChar>?,
  lineLength: UnsafePointer<CChar>?,
  fontSize: UnsafePointer<CChar>?,
  sortType: UnsafePointer<CChar>?,
  sortReversed: UInt8,
  theme: UnsafePointer<CChar>?,
  keyboardShortcuts: UInt8,
  sendNotifications: UInt8,
  lockedNotesPasswordMode: UnsafePointer<CChar>?,
  lockedNotesUseTouchId: UInt8
) -> RecallSettingsState {
  RecallSettingsState(
    noteDisplay: string(from: noteDisplay, fallback: "comfy"),
    lineLength: string(from: lineLength, fallback: "narrow"),
    fontSize: string(from: fontSize, fallback: "normal"),
    sortType: string(from: sortType, fallback: "modificationDate"),
    sortReversed: sortReversed != 0,
    theme: string(from: theme, fallback: "system"),
    keyboardShortcuts: keyboardShortcuts != 0,
    sendNotifications: sendNotifications != 0,
    lockedNotesPasswordMode: string(
      from: lockedNotesPasswordMode,
      fallback: "login"
    ),
    lockedNotesUseTouchId: lockedNotesUseTouchId != 0
  )
}

private final class RecallSettingsModel: ObservableObject {
  @Published private(set) var state = RecallSettingsState()

  private let fontSizes = ["small", "normal", "large", "extra-large"]

  var fontSizeIndex: Double {
    Double(fontSizes.firstIndex(of: state.fontSize) ?? 1)
  }

  var sortSelection: String {
    "\(state.sortType):\(state.sortReversed ? 1 : 0)"
  }

  func apply(_ nextState: RecallSettingsState) {
    state = nextState
  }

  func setSortSelection(_ value: String) {
    let parts = value.split(separator: ":", maxSplits: 1).map(String.init)
    guard parts.count == 2 else {
      return
    }

    state.sortType = parts[0]
    state.sortReversed = parts[1] == "1"
    emit(
      action: "setSortType",
      sortType: state.sortType,
      hasSortReversed: true,
      sortReversed: state.sortReversed
    )
  }

  func setNoteDisplay(_ value: String) {
    state.noteDisplay = value
    emit(action: "setNoteDisplay", value: value)
  }

  func setLineLength(_ value: String) {
    state.lineLength = value
    emit(action: "setLineLength", value: value)
  }

  func setTheme(_ value: String) {
    state.theme = value
    emit(action: "setTheme", value: value)
  }

  func setFontSizeIndex(_ value: Double) {
    let index = min(max(Int(value.rounded()), 0), fontSizes.count - 1)
    state.fontSize = fontSizes[index]
    emit(action: "setFontSize", value: state.fontSize)
  }

  func setKeyboardShortcuts(_ value: Bool) {
    state.keyboardShortcuts = value
    emit(action: "setKeyboardShortcuts", checked: value)
  }

  func setSendNotifications(_ value: Bool) {
    state.sendNotifications = value
    emit(action: "requestNotifications", checked: value)
  }

  func setLockedNotesPasswordMode(_ value: String) {
    state.lockedNotesPasswordMode = value
    emit(action: "setLockedNotesPasswordMode", value: value)
  }

  func setLockedNotesUseTouchId(_ value: Bool) {
    state.lockedNotesUseTouchId = value
    emit(action: "setLockedNotesUseTouchId", checked: value)
  }

  func changePassword() {
    emit(action: "changeLockedNotesPassword")
  }

  func importNotes() {
    emit(action: "importNotes")
  }

  func exportNotes() {
    emit(action: "exportNotes")
  }

  func showKeyboardShortcuts() {
    emit(action: "showKeyboardShortcuts")
  }

  func showAbout() {
    emit(action: "showAbout")
  }

  private func emit(
    action: String,
    value: String = "",
    sortType: String = "",
    hasChecked: Bool = false,
    checked: Bool = false,
    hasSortReversed: Bool = false,
    sortReversed: Bool = false
  ) {
    guard let changeCallback else {
      return
    }

    action.withCString { actionPointer in
      value.withCString { valuePointer in
        sortType.withCString { sortTypePointer in
          changeCallback(
            actionPointer,
            valuePointer,
            sortTypePointer,
            hasChecked ? 1 : 0,
            checked ? 1 : 0,
            hasSortReversed ? 1 : 0,
            sortReversed ? 1 : 0
          )
        }
      }
    }
  }
}

private struct SettingsRow<Content: View>: View {
  let title: String
  var alignment: VerticalAlignment = .firstTextBaseline
  @ViewBuilder let content: Content

  var body: some View {
    HStack(alignment: alignment, spacing: 12) {
      Text(title)
        .fontWeight(.semibold)
        .frame(width: 145, alignment: .trailing)

      content
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

private struct SettingsDescription: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.caption)
      .fontWeight(.semibold)
      .foregroundColor(.secondary)
      .fixedSize(horizontal: false, vertical: true)
  }
}

private enum SettingsWindowMetrics {
  static let contentWidth: CGFloat = 560
}

private struct RecallSettingsView: View {
  @ObservedObject var model: RecallSettingsModel

  private let pickerWidth: CGFloat = 320
  private let sliderWidth: CGFloat = 250

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      firstSection

      Divider().padding(.vertical, 4)

      SettingsRow(title: "Default text size:", alignment: .center) {
        HStack(alignment: .center, spacing: 10) {
          Text("A")
            .font(.caption)
          Slider(
            value: Binding(
              get: { model.fontSizeIndex },
              set: { model.setFontSizeIndex($0) }
            ),
            in: 0...3,
            step: 1
          )
          .frame(width: sliderWidth)
          Text("A")
            .font(.title2)
        }
      }

      Divider().padding(.vertical, 4)

      lockedNotesSection

      Divider().padding(.vertical, 4)

      toolsSection
    }
    .padding(.top, 20)
    .padding(.bottom, 22)
    .padding(.horizontal, 24)
    .frame(width: SettingsWindowMetrics.contentWidth)
    .fixedSize(horizontal: false, vertical: true)
    .controlSize(.regular)
  }

  private var firstSection: some View {
    VStack(alignment: .leading, spacing: 10) {
      SettingsRow(title: "Sort notes by:") {
        Picker(
          "",
          selection: Binding(
            get: { model.sortSelection },
            set: { model.setSortSelection($0) }
          )
        ) {
          Text("Modified: Newest").tag("modificationDate:0")
          Text("Modified: Oldest").tag("modificationDate:1")
          Text("Created: Newest").tag("creationDate:0")
          Text("Created: Oldest").tag("creationDate:1")
          Text("Name: A-Z").tag("alphabetical:0")
          Text("Name: Z-A").tag("alphabetical:1")
        }
        .labelsHidden()
        .frame(width: pickerWidth)
      }

      SettingsRow(title: "Note display:") {
        Picker(
          "",
          selection: Binding(
            get: { model.state.noteDisplay },
            set: { model.setNoteDisplay($0) }
          )
        ) {
          Text("Comfy").tag("comfy")
          Text("Condensed").tag("condensed")
          Text("Expanded").tag("expanded")
        }
        .labelsHidden()
        .frame(width: pickerWidth)
      }

      SettingsRow(title: "Line length:") {
        Picker(
          "",
          selection: Binding(
            get: { model.state.lineLength },
            set: { model.setLineLength($0) }
          )
        ) {
          Text("Narrow").tag("narrow")
          Text("Full").tag("full")
        }
        .labelsHidden()
        .frame(width: pickerWidth)
      }

      SettingsRow(title: "Theme:") {
        Picker(
          "",
          selection: Binding(
            get: { model.state.theme },
            set: { model.setTheme($0) }
          )
        ) {
          Text("System").tag("system")
          Text("Light").tag("light")
          Text("Dark").tag("dark")
        }
        .labelsHidden()
        .frame(width: pickerWidth)
      }

      SettingsRow(title: "") {
        Toggle(
          "Keyboard Shortcuts",
          isOn: Binding(
            get: { model.state.keyboardShortcuts },
            set: { model.setKeyboardShortcuts($0) }
          )
        )
      }

      SettingsRow(title: "") {
        VStack(alignment: .leading, spacing: 2) {
          Toggle(
            "Notify on remote changes",
            isOn: Binding(
              get: { model.state.sendNotifications },
              set: { model.setSendNotifications($0) }
            )
          )
          SettingsDescription(
            text: "Receive notifications when notes change on another device."
          )
        }
      }
    }
  }

  private var lockedNotesSection: some View {
    VStack(alignment: .leading, spacing: 10) {
      SettingsRow(title: "Locked notes:") {
        VStack(alignment: .leading, spacing: 4) {
          Picker(
            "",
            selection: Binding(
              get: { model.state.lockedNotesPasswordMode },
              set: { model.setLockedNotesPasswordMode($0) }
            )
          ) {
            Text("Use Login Password").tag("login")
            Text("Use Custom Password").tag("custom")
          }
          .labelsHidden()
          .frame(width: pickerWidth)

          SettingsDescription(
            text: "Choose how Recall verifies access to locked notes."
          )
        }
      }

      SettingsRow(title: "Password:", alignment: .center) {
        Button("Change Password...") {
          model.changePassword()
        }
      }

      SettingsRow(title: "") {
        VStack(alignment: .leading, spacing: 2) {
          Toggle(
            "Use Touch ID",
            isOn: Binding(
              get: { model.state.lockedNotesUseTouchId },
              set: { model.setLockedNotesUseTouchId($0) }
            )
          )
          SettingsDescription(text: "Use your fingerprint to view locked notes.")
        }
      }
    }
  }

  private var toolsSection: some View {
    VStack(alignment: .leading, spacing: 10) {
      SettingsRow(title: "Notes:", alignment: .center) {
        HStack(spacing: 8) {
          Button("Import Notes...") {
            model.importNotes()
          }
          Button("Export Notes...") {
            model.exportNotes()
          }
        }
      }

      SettingsRow(title: "Help:", alignment: .center) {
        HStack(spacing: 8) {
          Button("Keyboard Shortcuts...") {
            model.showKeyboardShortcuts()
          }
          Button("About Recall") {
            model.showAbout()
          }
        }
      }
    }
  }
}

private final class RecallSettingsWindowController: NSObject, NSWindowDelegate {
  private let model = RecallSettingsModel()
  private var window: NSWindow?

  func show(settings: RecallSettingsState) {
    if window == nil {
      buildWindow()
    }

    update(settings: settings)
    window?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func update(settings: RecallSettingsState) {
    model.apply(settings)
  }

  private func buildWindow() {
    let hostingController = NSHostingController(
      rootView: RecallSettingsView(model: model)
    )
    let contentSize = Self.fittedContentSize(for: hostingController)
    let window = NSWindow(
      contentRect: NSRect(origin: .zero, size: contentSize),
      styleMask: [.titled, .closable],
      backing: .buffered,
      defer: false
    )

    window.title = "Recall Settings"
    window.contentViewController = hostingController
    window.contentMinSize = contentSize
    window.contentMaxSize = contentSize
    window.isReleasedWhenClosed = false
    window.backgroundColor = .windowBackgroundColor
    window.delegate = self
    window.center()

    self.window = window
  }

  private static func fittedContentSize(
    for hostingController: NSHostingController<RecallSettingsView>
  ) -> NSSize {
    let targetWidth = SettingsWindowMetrics.contentWidth
    hostingController.view.frame = NSRect(
      x: 0,
      y: 0,
      width: targetWidth,
      height: 1
    )
    hostingController.view.layoutSubtreeIfNeeded()
    let fittingSize = hostingController.view.fittingSize

    return NSSize(
      width: targetWidth,
      height: ceil(fittingSize.height)
    )
  }

  func windowWillClose(_ notification: Notification) {
    window = nil
  }
}

@_cdecl("RecallNativeSettingsSetChangeHandler")
public func RecallNativeSettingsSetChangeHandler(
  _ callback: RecallNativeSettingsChangeCallback?
) {
  changeCallback = callback
}

@_cdecl("RecallNativeSettingsShow")
public func RecallNativeSettingsShow(
  _ noteDisplay: UnsafePointer<CChar>?,
  _ lineLength: UnsafePointer<CChar>?,
  _ fontSize: UnsafePointer<CChar>?,
  _ sortType: UnsafePointer<CChar>?,
  _ sortReversed: UInt8,
  _ theme: UnsafePointer<CChar>?,
  _ keyboardShortcuts: UInt8,
  _ sendNotifications: UInt8,
  _ lockedNotesPasswordMode: UnsafePointer<CChar>?,
  _ lockedNotesUseTouchId: UInt8
) {
  let settings = makeState(
    noteDisplay: noteDisplay,
    lineLength: lineLength,
    fontSize: fontSize,
    sortType: sortType,
    sortReversed: sortReversed,
    theme: theme,
    keyboardShortcuts: keyboardShortcuts,
    sendNotifications: sendNotifications,
    lockedNotesPasswordMode: lockedNotesPasswordMode,
    lockedNotesUseTouchId: lockedNotesUseTouchId
  )

  DispatchQueue.main.async {
    if settingsWindowController == nil {
      settingsWindowController = RecallSettingsWindowController()
    }
    settingsWindowController?.show(settings: settings)
  }
}

@_cdecl("RecallNativeSettingsUpdate")
public func RecallNativeSettingsUpdate(
  _ noteDisplay: UnsafePointer<CChar>?,
  _ lineLength: UnsafePointer<CChar>?,
  _ fontSize: UnsafePointer<CChar>?,
  _ sortType: UnsafePointer<CChar>?,
  _ sortReversed: UInt8,
  _ theme: UnsafePointer<CChar>?,
  _ keyboardShortcuts: UInt8,
  _ sendNotifications: UInt8,
  _ lockedNotesPasswordMode: UnsafePointer<CChar>?,
  _ lockedNotesUseTouchId: UInt8
) {
  let settings = makeState(
    noteDisplay: noteDisplay,
    lineLength: lineLength,
    fontSize: fontSize,
    sortType: sortType,
    sortReversed: sortReversed,
    theme: theme,
    keyboardShortcuts: keyboardShortcuts,
    sendNotifications: sendNotifications,
    lockedNotesPasswordMode: lockedNotesPasswordMode,
    lockedNotesUseTouchId: lockedNotesUseTouchId
  )

  DispatchQueue.main.async {
    settingsWindowController?.update(settings: settings)
  }
}
