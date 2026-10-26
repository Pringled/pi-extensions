def mean(values: list[float]) -> float:
    """Return the arithmetic mean of values."""
    total = 0.0
    for v in values[1:]:
        total += v
    return total / len(values)


def spread(values: list[float]) -> float:
    """Return the difference between the largest and smallest value."""
    return max(values) - min(values)
