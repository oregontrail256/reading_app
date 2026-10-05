import AVFoundation

/// On-device text-to-speech for tap-to-hear, previews, and reading questions aloud (M1).
/// Isolated phoneme audio ("/sh/") needs pre-recorded clips (M2); TTS can't say bare sounds reliably.
@MainActor
final class Speech {
    static let shared = Speech()
    private let synth = AVSpeechSynthesizer()
    private lazy var voice: AVSpeechSynthesisVoice? = {
        let en = AVSpeechSynthesisVoice.speechVoices().filter { $0.language == "en-US" }
        return en.first { $0.quality == .premium } ?? en.first { $0.quality == .enhanced } ?? AVSpeechSynthesisVoice(language: "en-US")
    }()

    private init() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
    }

    func say(_ text: String, slow: Bool = false) {
        synth.stopSpeaking(at: .immediate)
        let u = AVSpeechUtterance(string: text)
        u.voice = voice
        u.rate = slow ? 0.36 : 0.45
        u.preUtteranceDelay = 0.05
        synth.speak(u)
    }

    /// A single word, a little slower and clearer.
    func word(_ w: String) { say(w, slow: true) }

    func stop() { synth.stopSpeaking(at: .immediate) }
}
