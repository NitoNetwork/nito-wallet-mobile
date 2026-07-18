import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import genMatrix from "./genMatrix";

const DEFAULT_QUIET_ZONE_MODULES = 4;

const buildRuns = (matrix) => {
  const runs = [];

  matrix.forEach((row, rowIndex) => {
    let start = -1;

    for (let columnIndex = 0; columnIndex <= row.length; columnIndex += 1) {
      const isDark = columnIndex < row.length && Boolean(row[columnIndex]);

      if (isDark && start === -1) {
        start = columnIndex;
      } else if (!isDark && start !== -1) {
        runs.push({ row: rowIndex, start, length: columnIndex - start });
        start = -1;
      }
    }
  });

  return runs;
};

const QRCode = ({
  value = "Nito Wallet",
  size = 100,
  color = "black",
  backgroundColor = "white",
  quietZone = 0,
  ecl = "M",
  getRef,
  testID,
}) => {
  const matrix = useMemo(() => genMatrix(value, ecl), [value, ecl]);
  const moduleCount = matrix.length;
  const requestedQuietModules = Math.ceil(quietZone / Math.max(1, size / moduleCount));
  const quietModules = Math.max(DEFAULT_QUIET_ZONE_MODULES, requestedQuietModules);
  const totalModules = moduleCount + quietModules * 2;
  const cellSize = Math.max(1, Math.floor(size / totalModules));
  const renderedSize = cellSize * totalModules;
  const origin = Math.floor((size - renderedSize) / 2) + quietModules * cellSize;
  const runs = useMemo(() => buildRuns(matrix), [matrix]);

  return (
    <View
      ref={getRef}
      testID={testID}
      style={[styles.container, { width: size, height: size, backgroundColor }]}
    >
      {runs.map((run) => (
        <View
          key={`${run.row}:${run.start}`}
          style={[
            styles.run,
            {
              backgroundColor: color,
              left: origin + run.start * cellSize,
              top: origin + run.row * cellSize,
              width: run.length * cellSize,
              height: cellSize,
            },
          ]}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    position: "relative",
  },
  run: {
    position: "absolute",
  },
});

export default QRCode;
