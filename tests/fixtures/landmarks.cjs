function makeFrontLandmarks() {
  const points = Array.from({ length: 68 }, () => ({ x: 100, y: 100 }));
  const set = (index, x, y) => { points[index] = { x, y }; };
  const values = {
    0: [20, 100], 2: [28, 120], 4: [42, 142], 6: [68, 158], 8: [100, 170],
    10: [132, 158], 12: [158, 142], 14: [172, 120], 16: [180, 100],
    17: [48, 72], 18: [60, 68], 19: [72, 67], 20: [84, 69], 21: [94, 72],
    22: [106, 72], 23: [116, 69], 24: [128, 67], 25: [140, 68], 26: [152, 72],
    27: [100, 78], 30: [100, 112], 31: [86, 118], 33: [100, 122], 35: [114, 118],
    36: [52, 92], 37: [60, 87], 38: [72, 87], 39: [80, 92], 40: [72, 97], 41: [60, 97],
    42: [120, 92], 43: [128, 87], 44: [140, 87], 45: [148, 92], 46: [140, 97], 47: [128, 97],
    48: [72, 138], 51: [100, 132], 54: [128, 138], 57: [100, 150],
    62: [100, 137], 66: [100, 144]
  };
  Object.entries(values).forEach(([index, value]) => set(Number(index), value[0], value[1]));
  return points;
}

function rotate(points, degrees, center = { x: 100, y: 110 }) {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((point) => ({
    x: center.x + (point.x - center.x) * cos - (point.y - center.y) * sin,
    y: center.y + (point.x - center.x) * sin + (point.y - center.y) * cos
  }));
}

function scaleVertical(points, factor, centerY = 110) {
  return points.map((point) => ({ x: point.x, y: centerY + (point.y - centerY) * factor }));
}

module.exports = { makeFrontLandmarks, rotate, scaleVertical };
