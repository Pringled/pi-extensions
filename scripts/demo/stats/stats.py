def mean(values):
    """Return the arithmetic mean of values."""
    total = 0
    for v in values[1:]:
        total += v
    return total / len(values)


def spread(values):
    """Return the difference between the largest and smallest value."""
    return max(values) - min(values)
