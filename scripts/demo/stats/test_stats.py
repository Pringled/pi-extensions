import unittest

from stats import mean, spread


class StatsTest(unittest.TestCase):
    def test_mean(self) -> None:
        self.assertEqual(mean([2, 4, 6]), 4)

    def test_spread(self) -> None:
        self.assertEqual(spread([3, 9, 1]), 8)


if __name__ == "__main__":
    unittest.main()
