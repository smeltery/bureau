import { useCallback, useState } from "react";

export function useOfficeDoorFeedback() {
  const [leftDoorDragOver, setLeftDoorDragOver] = useState(false);
  const [rightDoorDragOver, setRightDoorDragOver] = useState(false);
  const [leftDoorReject, setLeftDoorReject] = useState(false);
  const [rightDoorReject, setRightDoorReject] = useState(false);

  const rejectLeftDoor = useCallback(() => {
    setLeftDoorReject(true);
    setTimeout(() => setLeftDoorReject(false), 400);
  }, []);
  const rejectRightDoor = useCallback(() => {
    setRightDoorReject(true);
    setTimeout(() => setRightDoorReject(false), 400);
  }, []);

  return {
    leftDoorDragOver,
    setLeftDoorDragOver,
    rightDoorDragOver,
    setRightDoorDragOver,
    leftDoorReject,
    rightDoorReject,
    rejectLeftDoor,
    rejectRightDoor,
  };
}
