function calculateEffortScore(metrics = {}) {
  const {
    clicks = 0,
    shares = 0,
    conversions = 0,
    usageCount = metrics.usage_count || 0,
    verifiedRewardPoints,
  } = metrics;
  const numericClicks = Number(clicks) || 0;
  const numericShares = Number(shares) || 0;
  const numericConversions = Number(conversions) || 0;
  const numericUsage = Number(usageCount) || 0;
  const verifiedScore = verifiedRewardPoints === undefined
    ? numericConversions * 5
    : Math.max(Number(verifiedRewardPoints) || 0, 0);

  const preThresholdScore = numericClicks * 0.5 + numericShares * 1 + verifiedScore;
  const postThresholdScore = verifiedScore;
  const rewardMultiplier = numericUsage >= 4 ? postThresholdScore : preThresholdScore;
  const discountEarned = Math.min(verifiedScore * 0.01, 0.3);

  return {
    effortScore: Number(rewardMultiplier.toFixed(2)),
    conversionScore: Number(postThresholdScore.toFixed(2)),
    discountEarned: Number(discountEarned.toFixed(2)),
  };
}

function determineTier(verifiedRewardPoints = 0) {
  const points = Math.max(Number(verifiedRewardPoints) || 0, 0);
  if (points >= 20) {
    return {
      tier: 'community',
      maxDiscount: 0.3,
      customizationLimit: null,
    };
  }
  if (points >= 5) {
    return {
      tier: 'maker',
      maxDiscount: 0.2,
      customizationLimit: 3,
    };
  }

  return {
    tier: 'crumb',
    maxDiscount: 0.1,
    customizationLimit: 1,
  };
}

function applyTierDiscountCap(discountEarned, verifiedRewardPoints) {
  const tierDetails = determineTier(verifiedRewardPoints);
  return {
    ...tierDetails,
    discountEarned: Number(Math.min(Number(discountEarned) || 0, tierDetails.maxDiscount).toFixed(2)),
  };
}

module.exports = {
  calculateEffortScore,
  determineTier,
  applyTierDiscountCap,
};
