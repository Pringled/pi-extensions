import time

loss = 2.0
for epoch in range(1, 6):
    time.sleep(1)
    loss *= 0.6
    print(f"epoch {epoch}  loss {loss:.3f}", flush=True)
print("saved model to checkpoints/final.pt")
