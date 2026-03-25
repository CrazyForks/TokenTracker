import SwiftUI

/// Clawd pixel-art companion with full animation suite.
/// Animations ported from Clawd-on-Desk SVG keyframes.
struct ClawdCompanionView: View {
    @ObservedObject var viewModel: DashboardViewModel

    @State private var eyesClosed = false
    @State private var hoverSide: HoverSide = .none
    @State private var currentAction: CharacterAction = .none
    @State private var quipIndex = 0
    @State private var armWave = false
    @State private var syncRotation: Double = 0
    @State private var hoveringSync = false
    @State private var hoveringCharacter = false

    private let px: CGFloat = 4.0

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            characterView
                .frame(width: 15 * px, height: 11 * px)
                .modifier(ActionModifier(action: currentAction))
                .onContinuousHover { phase in
                    switch phase {
                    case .active(let loc):
                        if !hoveringCharacter { NSCursor.pointingHand.push() }
                        hoveringCharacter = true
                        let mid = 15 * px / 2
                        hoverSide = loc.x < mid - 10 ? .left : (loc.x > mid + 10 ? .right : .center)
                    case .ended:
                        if hoveringCharacter { NSCursor.pop() }
                        hoveringCharacter = false
                        hoverSide = .none
                    }
                }
                .onTapGesture { handleTap() }

            bubbleView
                .id("quip-\(quipIndex)")
                .offset(y: -2)

            Spacer(minLength: 0)

            syncButton
        }
        .padding(.horizontal, 20)
        .padding(.top, 24)
        .padding(.bottom, 10)
        .onAppear { startBlinkLoop() }
    }

    // MARK: - Speech Bubble

    @State private var hoveringBubble = false

    private var bubbleView: some View {
        Text(currentQuip)
            .font(.system(size: 12))
            .foregroundStyle(.primary.opacity(0.75))
            .lineLimit(3)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .background {
                BubbleShape()
                    .fill(.regularMaterial)
                    .shadow(color: .black.opacity(0.03), radius: 1, y: 0.5)
            }
            .scaleEffect(hoveringBubble ? 1.03 : 1.0)
            .animation(.easeOut(duration: 0.12), value: hoveringBubble)
            .onHover { h in
                hoveringBubble = h
                if h { NSCursor.pointingHand.push() } else { NSCursor.pop() }
            }
            .onTapGesture { handleTap() }
            .transition(.asymmetric(
                insertion: .opacity.combined(with: .scale(scale: 0.92, anchor: .leading)),
                removal: .opacity
            ))
    }

    // MARK: - Sync Button

    private var syncButton: some View {
        Button {
            Task { await viewModel.triggerSync() }
        } label: {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 11))
                .foregroundStyle(viewModel.isSyncing ? .tertiary : (hoveringSync ? .primary : .secondary))
                .rotationEffect(.degrees(syncRotation))
                .scaleEffect(hoveringSync && !viewModel.isSyncing ? 1.15 : 1.0)
                .animation(.easeOut(duration: 0.15), value: hoveringSync)
        }
        .frame(width: 24, height: 24)
        .contentShape(Rectangle())
        .buttonStyle(.plain)
        .onHover { h in
            hoveringSync = h
            if h { NSCursor.pointingHand.push() } else { NSCursor.pop() }
        }
        .disabled(viewModel.isSyncing)
        .onChange(of: viewModel.isSyncing) { syncing in
            if syncing {
                withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) { syncRotation = 360 }
            } else {
                withAnimation(.default) { syncRotation = 0 }
            }
        }
    }

    // MARK: - Character Canvas (all animations time-driven)

    private var characterView: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 15.0)) { timeline in
            Canvas { context, size in
                let t = timeline.date.timeIntervalSinceReferenceDate
                let s = px
                let yBase: CGFloat = 6
                let yOff: CGFloat = (size.height - 10 * s) / 2
                let syncing = viewModel.isSyncing
                let sleeping = mood == .sleeping

                // === BODY TRANSFORMS ===

                // Breathing (3.2s cycle)
                let breathPhase = sin(t / 3.2 * .pi * 2)
                let breathY = breathPhase * 0.5

                // Syncing jitter (0.08s cycle, like typing)
                let jitter: CGFloat = syncing ? sin(t * 78.5) * 0.5 : 0

                // Idle sway (8s cycle, subtle lean left/right)
                let swayPhase = sin(t / 8.0 * .pi * 2)
                let idleSway: CGFloat = (!syncing && !sleeping) ? swayPhase * 0.6 : 0

                // Hover lean
                let hoverLean: CGFloat = switch hoverSide {
                case .left: -1.2
                case .right: 1.2
                case .center: 0
                case .none: 0
                }

                let totalX = idleSway + hoverLean
                let totalY = breathY + jitter

                func r(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
                    CGRect(x: (x + totalX) * s, y: (y - yBase) * s + yOff + totalY * s,
                           width: w * s, height: h * s)
                }

                let body = Color(red: 0.87, green: 0.53, blue: 0.43)
                let eye = Color.black

                // === SHADOW ===
                let shadowScaleX: CGFloat = 1.0 + breathPhase * 0.03
                let shadowW: CGFloat = 9 * shadowScaleX
                let shadowX: CGFloat = 3 + (9 - shadowW) / 2
                context.fill(Path(r(shadowX, 15, shadowW, 0.5)),
                             with: .color(.black.opacity(0.12)))

                // === LEGS ===
                for lx: CGFloat in [3, 5, 9, 11] {
                    context.fill(Path(r(lx, 13, 1, 2)), with: .color(body))
                }

                // === TORSO (with breathing scale) ===
                let torsoScaleX: CGFloat = 1.0 + breathPhase * 0.015
                let torsoScaleY: CGFloat = 1.0 - breathPhase * 0.015
                let torsoW: CGFloat = 11 * torsoScaleX
                let torsoH: CGFloat = 7 * torsoScaleY
                let torsoX: CGFloat = 2 + (11 - torsoW) / 2
                let torsoY: CGFloat = 6 + (7 - torsoH)  // anchor at bottom
                context.fill(Path(r(torsoX, torsoY, torsoW, torsoH)), with: .color(body))

                // === ARMS ===
                if syncing {
                    // Typing: arms oscillate up/down rapidly
                    let leftArmY: CGFloat = 9 + sin(t * 41.9) * 1.5
                    let rightArmY: CGFloat = 9 + sin(t * 52.4) * 1.5
                    context.fill(Path(r(0, leftArmY, 2, 2)), with: .color(body))
                    context.fill(Path(r(13, rightArmY, 2, 2)), with: .color(body))
                } else {
                    let leftArmYShift: CGFloat = armWave ? -2.5 : 0
                    context.fill(Path(r(0, 9 + leftArmYShift, 2, 2)), with: .color(body))
                    context.fill(Path(r(13, 9, 2, 2)), with: .color(body))
                }

                // === EYES ===
                if sleeping || eyesClosed {
                    // Closed: thin horizontal line
                    context.fill(Path(r(4, 9, 1, 0.35)), with: .color(eye))
                    context.fill(Path(r(10, 9, 1, 0.35)), with: .color(eye))
                } else {
                    // Eye shift: hover tracking > idle wander > syncing scan
                    let eyeShift: CGFloat
                    if hoverSide != .none {
                        eyeShift = switch hoverSide {
                        case .left: -0.5
                        case .right: 0.5
                        case .center: 0
                        case .none: 0
                        }
                    } else if syncing {
                        // Scanning: eyes sweep left-right (1.2s cycle)
                        let scanPhase = (t / 1.2).truncatingRemainder(dividingBy: 1.0)
                        eyeShift = CGFloat(scanPhase < 0.5 ? scanPhase * 4 - 1 : 3 - scanPhase * 4)
                    } else {
                        // Idle wander (8s cycle)
                        let wanderT = (t / 8.0).truncatingRemainder(dividingBy: 1.0)
                        if wanderT < 0.15 || wanderT > 0.85 { eyeShift = 0 }
                        else if wanderT < 0.35 { eyeShift = 0.5 }
                        else if wanderT < 0.5 { eyeShift = 0 }
                        else if wanderT < 0.7 { eyeShift = -0.5 }
                        else { eyeShift = 0 }
                    }
                    context.fill(Path(r(4 + eyeShift, 8, 1, 2)), with: .color(eye))
                    context.fill(Path(r(10 + eyeShift, 8, 1, 2)), with: .color(eye))
                }

                // === SLEEPING Z's ===
                if sleeping {
                    for i in 0..<2 {
                        let zT = (t + Double(i) * 1.0).truncatingRemainder(dividingBy: 2.5) / 2.5
                        let rise = zT * 5
                        let alpha = zT < 0.2 ? zT * 5 : (zT > 0.7 ? (1.0 - zT) / 0.3 : 1.0)
                        let fontSize: CGFloat = i == 0 ? 9 : 12
                        let xPos: CGFloat = i == 0 ? 13 : 14.5
                        context.draw(
                            Text(i == 0 ? "z" : "Z")
                                .font(.system(size: fontSize, weight: .bold, design: .monospaced))
                                .foregroundColor(.secondary.opacity(alpha * 0.5)),
                            at: CGPoint(x: (xPos + totalX) * s, y: (3 - rise - yBase) * s + yOff + totalY * s)
                        )
                    }
                }

                // === SYNCING DATA PARTICLES ===
                if syncing {
                    let particleColor = Color(red: 0.25, green: 0.77, blue: 1.0) // #40C4FF
                    for i in 0..<6 {
                        let pT = (t * 1.2 + Double(i) * 0.17).truncatingRemainder(dividingBy: 1.0)
                        let pY = 14.0 - pT * 14.0
                        let pX = 7.5 + sin(Double(i) * 2.1) * 3.5
                        let alpha = pT < 0.15 ? pT / 0.15 : (pT > 0.75 ? (1.0 - pT) / 0.25 : 1.0)
                        let pSize: CGFloat = 0.4 + CGFloat(pT) * 0.3
                        context.fill(Path(r(CGFloat(pX), CGFloat(pY), pSize, pSize)),
                                     with: .color(particleColor.opacity(alpha * 0.8)))
                    }
                }

                // === HOVER GLOW (subtle highlight on character) ===
                if hoveringCharacter && !sleeping {
                    context.fill(Path(r(torsoX, torsoY, torsoW, torsoH)),
                                 with: .color(.white.opacity(0.06)))
                }
            }
        }
    }

    // MARK: - Mood

    private enum Mood { case sleeping, idle, happy, excited }

    private var mood: Mood {
        if viewModel.todayTokens == 0 { return .sleeping }
        if viewModel.todayTokens < 100_000 { return .idle }
        if viewModel.todayTokens < 1_000_000 { return .happy }
        return .excited
    }

    // MARK: - Quip Pool (30+ English lines)

    private var currentQuip: String {
        let pool = quipPool
        guard !pool.isEmpty else { return "" }
        return pool[quipIndex % pool.count]
    }

    private var quipPool: [String] {
        let tokens = viewModel.todayTokens
        let cost = viewModel.todayCost
        let f = TokenFormatter.formatCompact(tokens)

        if viewModel.isSyncing {
            return [
                "⏳ Crunching numbers...",
                "📡 Fetching latest data!",
                "🔄 One moment, syncing...",
                "🧮 Counting your tokens~",
            ]
        }

        var pool: [String] = []

        // === Today data ===
        if tokens == 0 {
            pool += [
                "😴 No tokens yet today",
                "💬 Start chatting to wake me up!",
                "🌙 Quiet day so far...",
                "⌨️ Waiting for your first prompt",
                "💤 Zzz... nothing to count",
                "🌅 The calm before the storm?",
                "✨ I'm ready when you are!",
            ]
        } else {
            pool.append("📊 Today: \(f) tokens")
            if cost != "$0.00" && cost != "$0" {
                pool += [
                    "📈 \(f) tokens — \(cost) spent today",
                    "💰 \(cost) invested in AI so far",
                    "🧾 Today's bill: \(cost) for \(f) tokens",
                    "💳 AI tab today: \(cost)",
                ]
            }
            if tokens < 50_000 {
                pool += ["☕ Just warming up!", "🌱 A gentle start"]
            } else if tokens < 200_000 {
                pool += ["🎯 Getting into the flow!", "💪 Solid progress today"]
            } else if tokens < 500_000 {
                pool += ["🔥 Busy day!", "⚡ You're on a roll!"]
            } else if tokens < 2_000_000 {
                pool += ["🚀 Heavy usage today!", "🖨️ Token machine goes brrr"]
            } else {
                pool += ["🤯 MASSIVE day!", "🔥 Token counter on fire!"]
            }
        }

        // === 7-Day / 30-Day rolling stats ===
        let w7 = viewModel.last7dTokens
        let d7 = viewModel.last7dActiveDays
        let m30 = viewModel.last30dTokens
        let avg = viewModel.last30dAvgPerDay

        if w7 > 0 {
            pool.append("📅 7-day total: \(TokenFormatter.formatCompact(w7)) tokens")
            if d7 > 0 {
                pool.append("🗓️ \(d7) active days this week")
                if d7 >= 7 {
                    pool.append("🏆 7/7 active days — perfect streak!")
                }
            }
        }
        if m30 > 0 {
            pool.append("📆 30-day total: \(TokenFormatter.formatCompact(m30)) tokens")
            if avg > 0 {
                pool.append("📊 Averaging ~\(TokenFormatter.formatCompact(avg))/day this month")
            }
        }

        // === Heatmap stats (streak, total active days) ===
        if let heatmap = viewModel.heatmap {
            let streak = heatmap.streakDays
            let totalActive = heatmap.activeDays
            if streak > 1 {
                pool.append("🔥 \(streak)-day streak! Keep it going")
            }
            if totalActive > 30 {
                pool.append("📈 \(totalActive) active days all-time!")
            }
        }

        // === Top model insights ===
        let models = viewModel.topModels
        if let top = models.first {
            pool.append("🥇 Top model: \(top.name) (\(top.percent))")
            if models.count >= 2 {
                pool.append("🥈 Runner-up: \(models[1].name) at \(models[1].percent)")
            }
            if models.count >= 3 {
                pool.append("🧰 Using \(models.count) different models")
            }
            // Source variety
            let sources = Set(models.map { $0.source })
            if sources.count >= 2 {
                let names = sources.map { $0.capitalized }.sorted().joined(separator: " + ")
                pool.append("🔀 Multi-tool setup: \(names)")
            }
        }

        // === Conversation count ===
        let convos = viewModel.todaySummary?.totals.conversationCount ?? 0
        if convos > 0 {
            pool.append("💬 \(convos) conversation\(convos == 1 ? "" : "s") today")
            if convos >= 10 {
                pool.append("🗣️ \(convos) chats! Busy talker today")
            }
        }

        // === Personality (always) ===
        pool += [
            "👆 Tap me for more!",
            "📋 I count so you don't have to",
            "✨ Every token tells a story",
            "🤝 Your AI spending buddy",
            "👋 Hey there~",
        ]

        return pool
    }

    // MARK: - Tap

    private func handleTap() {
        withAnimation(.easeInOut(duration: 0.25)) { quipIndex += 1 }
        let actions: [CharacterAction] = [.jump, .wiggle, .flip, .multiBlink, .wave]
        triggerAction(actions.randomElement() ?? .jump)
    }

    private func triggerAction(_ action: CharacterAction) {
        currentAction = action
        switch action {
        case .wave:
            armWave = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { armWave = false }
        case .multiBlink:
            Task { @MainActor in
                for _ in 0..<3 {
                    eyesClosed = true
                    try? await Task.sleep(nanoseconds: 80_000_000)
                    eyesClosed = false
                    try? await Task.sleep(nanoseconds: 80_000_000)
                }
            }
        default: break
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            if currentAction == action { currentAction = .none }
        }
    }

    // MARK: - Idle Blink

    private func startBlinkLoop() {
        let delay = Double.random(in: 2.5...5.0)
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            guard mood != .sleeping else { startBlinkLoop(); return }
            eyesClosed = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
                eyesClosed = false
                startBlinkLoop()
            }
        }
    }

    // MARK: - Types

    private enum HoverSide { case left, center, right, none }
    enum CharacterAction: Equatable { case none, jump, wiggle, flip, multiBlink, wave }
}

// MARK: - Action Modifier

private struct ActionModifier: ViewModifier {
    let action: ClawdCompanionView.CharacterAction
    @State private var offset: CGFloat = 0
    @State private var rotation: Double = 0
    @State private var scaleX: CGFloat = 1

    func body(content: Content) -> some View {
        content
            .offset(y: offset)
            .rotationEffect(.degrees(rotation))
            .scaleEffect(x: scaleX, y: 1)
            .onChange(of: action) { a in
                switch a {
                case .jump:
                    withAnimation(.interpolatingSpring(stiffness: 500, damping: 12)) { offset = -10 }
                    after(0.15) { withAnimation(.interpolatingSpring(stiffness: 500, damping: 12)) { offset = 0 } }
                case .wiggle:
                    withAnimation(.easeInOut(duration: 0.07).repeatCount(6, autoreverses: true)) { rotation = 6 }
                    after(0.45) { withAnimation(.easeOut(duration: 0.1)) { rotation = 0 } }
                case .flip:
                    withAnimation(.easeInOut(duration: 0.2)) { scaleX = -1 }
                    after(0.35) { withAnimation(.easeInOut(duration: 0.2)) { scaleX = 1 } }
                default: break
                }
            }
    }

    private func after(_ t: Double, _ block: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + t, execute: block)
    }
}

// MARK: - Bubble Shape

private struct BubbleShape: Shape {
    func path(in rect: CGRect) -> Path {
        let r: CGFloat = 8
        let tail: CGFloat = 6
        let tailY = rect.midY
        var p = Path()
        p.addRoundedRect(in: CGRect(x: tail, y: 0, width: rect.width - tail, height: rect.height),
                         cornerSize: CGSize(width: r, height: r))
        p.move(to: CGPoint(x: tail, y: tailY - 4))
        p.addLine(to: CGPoint(x: 0, y: tailY))
        p.addLine(to: CGPoint(x: tail, y: tailY + 4))
        p.closeSubpath()
        return p
    }
}
