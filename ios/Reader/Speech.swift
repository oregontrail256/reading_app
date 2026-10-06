import AVFoundation

/// On-device text-to-speech for tap-to-hear, previews, and reading questions aloud (M1).
/// Isolated phoneme audio ("/sh/") needs pre-recorded clips (M2); TTS can't say bare sounds reliably.
@MainActor
final class Speech {
    static let shared = Speech()
    private let synth = AVSpeechSynthesizer()
    private(set) var voice: AVSpeechSynthesisVoice?

    /// Apple's normal speaking rate. Slower than this sounds drawn out and robotic.
    private let sentenceRate = AVSpeechUtteranceDefaultSpeechRate
    /// Single tapped words: a touch slower so each sound is clear.
    private let wordRate = AVSpeechUtteranceDefaultSpeechRate * 0.88

    private init() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        refreshVoice()
    }

    /// The best installed US English voice: Premium, then Enhanced, then the default. Novelty voices
    /// (Albert, Bubbles…) are skipped. Call again after a voice is downloaded in Settings.
    func refreshVoice() {
        let en = AVSpeechSynthesisVoice.speechVoices().filter {
            $0.language == "en-US" && !$0.voiceTraits.contains(.isNoveltyVoice) && !$0.voiceTraits.contains(.isPersonalVoice)
        }
        voice = en.first { $0.quality == .premium } ?? en.first { $0.quality == .enhanced } ?? AVSpeechSynthesisVoice(language: "en-US")
        prewarm()
    }

    /// True when only the basic built-in voice is available (the robotic-sounding one).
    var usingBasicVoice: Bool { (voice?.quality ?? .default) == .default }

    var voiceDescription: String {
        guard let voice else { return "System default" }
        let q = switch voice.quality {
        case .premium: "Premium"
        case .enhanced: "Enhanced"
        default: "Basic"
        }
        return "\(voice.name) (\(q))"
    }

    /// The first utterance pays to load the voice; do that up front so the first tapped word speaks at once.
    private func prewarm() {
        let u = AVSpeechUtterance(string: " ")
        u.voice = voice
        u.volume = 0
        synth.speak(u)
    }

    func say(_ text: String) { speak(text, rate: sentenceRate) }

    /// A single word, a little slower and clearer.
    func word(_ w: String) { speak(w, rate: wordRate) }

    func stop() { synth.stopSpeaking(at: .immediate) }

    private func speak(_ text: String, rate: Float) {
        synth.stopSpeaking(at: .immediate)
        let u = AVSpeechUtterance(string: text)
        u.voice = voice
        u.rate = rate
        synth.speak(u)
    }
}
