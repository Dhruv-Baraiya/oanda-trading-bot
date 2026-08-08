import numpy as np


class MetaController:
    """Combines rule-based signals with AI predictions."""

    DIRECTION_MAP = {0: "UP", 1: "DOWN", 2: "FLAT"}

    def decide(
        self,
        rule_direction: str | None,
        universal_probs: list[float] | None,
        specialist_confidence: float | None = None,
        specialist_size: float | None = None,
    ) -> dict:
        if universal_probs is None:
            return {
                "action": "RULES_ONLY",
                "direction": rule_direction,
                "confidence": 0.5,
                "size_factor": 1.0,
                "reasoning": ["ML service unavailable, using rules only"],
            }

        up_prob, down_prob, flat_prob = universal_probs
        ai_direction = self.DIRECTION_MAP[int(np.argmax(universal_probs))]
        ai_max_prob = max(universal_probs)

        reasoning = []
        spec_conf = specialist_confidence or 0.5
        spec_size = specialist_size or 1.0

        # Decision matrix
        if rule_direction in ("BUY", "SELL"):
            rule_ai_match = (rule_direction == "BUY" and ai_direction == "UP") or \
                            (rule_direction == "SELL" and ai_direction == "DOWN")

            if rule_ai_match and ai_max_prob > 0.54:
                if spec_conf > 0.6:
                    action = "TRADE"
                    size_factor = min(spec_size, 1.5)
                    reasoning.append(f"Universal: {ai_direction} {ai_max_prob:.0%} (above threshold)")
                    reasoning.append(f"Specialist: {spec_conf:.0%} confidence")
                    reasoning.append(f"Rule signal agrees — triple confirmation")
                else:
                    action = "TRADE"
                    size_factor = 0.5
                    reasoning.append(f"Universal agrees but specialist low ({spec_conf:.0%})")
            elif ai_direction == "FLAT":
                if spec_conf > 0.6:
                    action = "TRADE"
                    size_factor = 0.5
                    reasoning.append(f"AI neutral, specialist confident — reduced size")
                else:
                    action = "SKIP"
                    size_factor = 0
                    reasoning.append("AI neutral, specialist low — skip")
            else:
                action = "SKIP"
                size_factor = 0
                reasoning.append(f"AI disagrees: {ai_direction} vs rule {rule_direction}")
        elif rule_direction is None or rule_direction == "FLAT":
            if ai_max_prob > 0.7:
                action = "AI_TRADE"
                direction = "BUY" if ai_direction == "UP" else "SELL"
                size_factor = 1.0
                reasoning.append(f"No rule signal but AI high confidence: {ai_direction} {ai_max_prob:.0%}")
            elif ai_max_prob > 0.6:
                action = "AI_TRADE"
                direction = "BUY" if ai_direction == "UP" else "SELL"
                size_factor = 0.5
                reasoning.append(f"No rule signal, AI moderate: {ai_direction} {ai_max_prob:.0%}")
            else:
                action = "NO_TRADE"
                size_factor = 0
                reasoning.append(f"No rule signal, AI not confident enough ({ai_max_prob:.0%})")
        else:
            action = "NO_TRADE"
            size_factor = 0

        # Final confidence
        rule_agrees = 1.0 if rule_direction in ("BUY", "SELL") and \
            ((rule_direction == "BUY" and ai_direction == "UP") or
             (rule_direction == "SELL" and ai_direction == "DOWN")) else 0.0

        final_confidence = 0.4 * ai_max_prob + 0.3 * spec_conf + 0.3 * rule_agrees

        # Confidence-based size scaling
        if final_confidence < 0.5:
            conf_scale = 0.5
        elif final_confidence < 0.7:
            conf_scale = 0.75
        elif final_confidence < 0.85:
            conf_scale = 1.0
        else:
            conf_scale = 1.25

        return {
            "action": action,
            "direction": rule_direction if action == "TRADE" else (direction if action == "AI_TRADE" else rule_direction),
            "confidence": round(final_confidence, 4),
            "size_factor": round(size_factor * conf_scale, 4),
            "ai_direction": ai_direction,
            "ai_probability": round(ai_max_prob, 4),
            "specialist_confidence": round(spec_conf, 4),
            "reasoning": reasoning,
        }
