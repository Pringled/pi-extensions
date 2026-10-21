import unittest

from stats import mean, spread


class StatsTest(unittest.TestCase):
    def test_mean(self):
        self.assertEqual(mean([2, 4, 6]), 4)

    def test_spread(self):
        self.assertEqual(spread([3, 9, 1]), 8)


if __name__ == "__main__":
    unittest.main()
