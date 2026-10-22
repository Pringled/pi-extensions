"""Trains a logistic regression classifier on freshly sampled synthetic data and saves the weights."""

import json
import math
import os
import random

random.seed(0)
FEATURES, BATCH_SIZE, BATCHES, EPOCHS, LR = 40, 10000, 20, 5, 0.5
true_w = [random.gauss(0, 1) for _ in range(FEATURES)]


def sample():
    x = [random.gauss(0, 1) for _ in range(FEATURES)]
    return x, 1.0 if sum(a * b for a, b in zip(x, true_w)) > 0 else 0.0


w = [0.0] * FEATURES
for epoch in range(1, EPOCHS + 1):
    loss = 0.0
    for batch in range(1, BATCHES + 1):
        grad = [0.0] * FEATURES
        for _ in range(BATCH_SIZE):
            x, t = sample()
            p = 1 / (1 + math.exp(-sum(a * b for a, b in zip(x, w))))
            loss -= t * math.log(p + 1e-9) + (1 - t) * math.log(1 - p + 1e-9)
            for i, a in enumerate(x):
                grad[i] += (p - t) * a
        w = [wi - LR * g / BATCH_SIZE for wi, g in zip(w, grad)]
        print(f"\rbatch {batch:2}/{BATCHES} |{'█' * batch}{' ' * (BATCHES - batch)}|", end="", flush=True)
    print(f"\repoch {epoch}  loss {loss / (BATCHES * BATCH_SIZE):.3f}" + " " * 20, flush=True)

os.makedirs("checkpoints", exist_ok=True)
with open("checkpoints/final.json", "w") as f:
    json.dump(w, f)
print("saved model to checkpoints/final.json")
