//import custom hooks
import { useAppDispatch, useAppSelector } from "store/store";

//import redux slices
import {
  toggleMenu,
  setCollapsed,
  MenuToggleType,
} from "store/slices/appSlice";

const useMenu = () => {
  const showMenu = useAppSelector((state) => state.app.showMenu);

  const dispatch = useAppDispatch();

  const toggleMenuHandler = (value: boolean) => {
    dispatch(toggleMenu({ showMenu: value }));
  };

  const handleCollapsed = (value: MenuToggleType) => {
    dispatch(setCollapsed({ value: value }));
  };

  return { toggleMenuHandler, showMenu, handleCollapsed };
};

export default useMenu;
