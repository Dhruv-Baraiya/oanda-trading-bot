import numpy as np


class MetaController:
    """Combines rule-based signals with AI predictions."""

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

        # Binary: universal_probs is [up_prob] or [up_prob, down_prob]
        if len(universal_probs) == 1:
            up_prob = universal_probs[0]
        elif len(universal_probs) == 2:
            up_prob = universal_probs[0]
        else:
            up_prob = universal_probs[0]

        ai_direction = "UP" if up_prob > 0.5 else "DOWN"
        ai_confidence = abs(up_prob - 0.5) * 2

        reasoning = []
        spec_conf = specialist_confidence or 0.5
        spec_size = specialist_size or 1.0

        if rule_direction in ("BUY", "SELL"):
            rule_ai_match = (rule_direction == "BUY" and ai_direction == "UP") or \
                            (rule_direction == "SELL" and ai_direction == "DOWN")

            if rule_ai_match and ai_confidence > 0.08:
                if spec_conf > 0.6:
                    action = "TRADE"
                    size_factor = min(spec_size, 1.5)
                    reasoning.append(f"Universal: {ai_direction} {up_prob:.0%} (confident)")
                    reasoning.append(f"Specialist: {spec_conf:.0%} confidence")
                    reasoning.append(f"Rule signal agrees — triple confirmation")
                else:
                    action = "TRADE"
                    size_factor = 0.5
                    reasoning.append(f"Universal agrees but specialist low ({spec_conf:.0%})")
            elif ai_confidence < 0.08:
                if spec_conf > 0.6:
                    action = "TRADE"
                    size_factor = 0.5
                    reasoning.append(f"AI neutral ({up_prob:.0%}), specialist confident — reduced size")
                else:
                    action = "SKIP"
                    size_factor = 0
                    reasoning.append(f"AI neutral ({up_prob:.0%}), specialist low — skip")
            else:
                action = "SKIP"
                size_factor = 0
                reasoning.append(f"AI disagrees: {ai_direction} vs rule {rule_direction}")
        elif rule_direction is None or rule_direction == "FLAT":
            if ai_confidence > 0.4:
                action = "AI_TRADE"
                direction = "BUY" if ai_direction == "UP" else "SELL"
                size_factor = 1.0
                reasoning.append(f"No rule signal but AI high confidence: {ai_direction} {up_prob:.0%}")
            elif ai_confidence > 0.2:
                action = "AI_TRADE"
                direction = "BUY" if ai_direction == "UP" else "SELL"
                size_factor = 0.5
                reasoning.append(f"No rule signal, AI moderate: {ai_direction} {up_prob:.0%}")
            else:
                action = "NO_TRADE"
                size_factor = 0
                reasoning.append(f"No rule signal, AI not confident enough ({up_prob:.0%})")
        else:
            action = "NO_TRADE"
            size_factor = 0

        rule_agrees = 1.0 if rule_direction in ("BUY", "SELL") and \
            ((rule_direction == "BUY" and ai_direction == "UP") or
             (rule_direction == "SELL" and ai_direction == "DOWN")) else 0.0

        final_confidence = 0.4 * (0.5 + ai_confidence * 0.5) + 0.3 * spec_conf + 0.3 * rule_agrees

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
            "ai_probability": round(up_prob, 4),
            "specialist_confidence": round(spec_conf, 4),
            "reasoning": reasoning,
        }
