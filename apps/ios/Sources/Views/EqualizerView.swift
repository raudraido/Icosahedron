import SwiftUI

/// 10-band equalizer with preamp and presets. The settings are shared with the web and desktop apps.
struct EqualizerContent: View {
    @State private var settings = EQManager.shared.settings

    private struct Preset { let name: LocalizedStringKey; let preamp: Double; let bands: [Double] }
    private static let presets: [Preset] = [
        Preset(name: "Flat", preamp: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        Preset(name: "Bass Boost", preamp: -3, bands: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0]),
        Preset(name: "Treble Boost", preamp: -3, bands: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6]),
        Preset(name: "Vocal", preamp: -2, bands: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1]),
        Preset(name: "Rock", preamp: -3, bands: [5, 4, 2, -1, -2, -1, 2, 4, 5, 5]),
        Preset(name: "Electronic", preamp: -3, bands: [5, 4, 1, 0, -2, 2, 1, 1, 4, 5]),
        Preset(name: "Loudness", preamp: -4, bands: [6, 4, 0, 0, -1, 0, -1, 0, 3, 5]),
    ]
    private static let labels = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"]

    var body: some View {
        VStack(spacing: 18) {
            Toggle("Equalizer", isOn: binding(\.enabled)).font(.headline)

            HStack(alignment: .bottom, spacing: 0) {
                column(label: "Preamp", value: binding(\.preampDb), range: -12...6)
                Divider().frame(height: 170).padding(.horizontal, 4)
                ForEach(0..<10, id: \.self) { i in
                    column(label: LocalizedStringKey(Self.labels[i]), value: bandBinding(i), range: -12...12)
                }
            }
            .opacity(settings.enabled ? 1 : 0.45)

            HStack {
                Menu {
                    ForEach(Array(Self.presets.enumerated()), id: \.offset) { _, p in
                        Button { apply(p) } label: { Text(p.name) }
                    }
                } label: { Label("Presets", systemImage: "slider.horizontal.3") }
                Spacer()
                Button("Reset") { apply(Self.presets[0]) }
            }
            Spacer(minLength: 0)
        }
        .padding()
        .onAppear { settings = EQManager.shared.settings }
    }

    // MARK: Pieces

    /// A vertical slider: a horizontal one turned a quarter around.
    private func column(label: LocalizedStringKey, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        VStack(spacing: 6) {
            Text(String(format: "%+.0f", value.wrappedValue)).font(.caption2).monospacedDigit().foregroundStyle(.secondary)
            Slider(value: value, in: range, step: 0.5)
                .frame(width: 150)
                .rotationEffect(.degrees(-90))
                .frame(width: 28, height: 150)
                .accessibilityLabel(label)
                .accessibilityValue(String(format: "%+.1f dB", value.wrappedValue))
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func binding(_ key: WritableKeyPath<EQSettings, Bool>) -> Binding<Bool> {
        Binding(get: { settings[keyPath: key] }, set: { settings[keyPath: key] = $0; EQManager.shared.update(settings) })
    }

    private func binding(_ key: WritableKeyPath<EQSettings, Double>) -> Binding<Double> {
        Binding(get: { settings[keyPath: key] }, set: { settings[keyPath: key] = $0; EQManager.shared.update(settings) })
    }

    private func bandBinding(_ i: Int) -> Binding<Double> {
        Binding(get: { settings.bandsDb[i] }, set: { settings.bandsDb[i] = $0; EQManager.shared.update(settings) })
    }

    private func apply(_ p: Preset) {
        settings.preampDb = p.preamp
        settings.bandsDb = p.bands
        if !p.bands.allSatisfy({ $0 == 0 }) { settings.enabled = true }
        EQManager.shared.update(settings)
    }
}

/// The equalizer as a sheet from the player.
struct EqualizerSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            EqualizerContent()
                .navigationTitle("Equalizer")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}
