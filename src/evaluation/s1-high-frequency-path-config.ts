export const S1_HIGH_FREQUENCY_PATH_METRIC_ID = "S1-HPE" as const;
export const S1_HIGH_FREQUENCY_PATH_METRIC_NAME = "高频活动路径效率" as const;
export const S1_HIGH_FREQUENCY_PATH_VERSION = "v0.1" as const;
export const S1_HIGH_FREQUENCY_PATH_STATUS = "v0.1 Demo 正式局部评分" as const;

export const S1_HIGH_FREQUENCY_PATH_ROUTE_GROUPS = [
  { routeGroup: "entry_to_kitchen", label: "主要归家到厨房", sourceCodePriority: [["SF10"], ["SF08"]], targetCodes: ["SF01", "SF02"] },
  { routeGroup: "garage_to_kitchen", label: "车库归家到厨房", sourceCodePriority: [["SF30"]], targetCodes: ["SF01", "SF02"] },
  { routeGroup: "bedroom_to_bathroom", label: "卧室到可用卫生间", sourceCodePriority: [["SF11", "SF12", "SF13", "SF14", "SF21"]], targetCodes: ["SF03", "SF04", "SF05"] },
] as const;

export const S1_HIGH_FREQUENCY_PATH_TURN_ANGLE_DEGREES = 15;
export const S1_HIGH_FREQUENCY_PATH_TURN_ANGLE_RADIANS = S1_HIGH_FREQUENCY_PATH_TURN_ANGLE_DEGREES * Math.PI / 180;
export const S1_HIGH_FREQUENCY_PATH_EQUAL_LENGTH_TOLERANCE_METERS = 0.01;
export const S1_HIGH_FREQUENCY_PATH_POINT_EPSILON_METERS = 1e-6;
