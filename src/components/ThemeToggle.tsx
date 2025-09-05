import React from 'react';
import { ActionIcon, useMantineColorScheme, Tooltip } from '@mantine/core';
import { IconSun, IconMoon } from '@tabler/icons-react';

export default function ThemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const dark = colorScheme === 'dark';

  return (
    <Tooltip label={dark ? 'Switch to light mode' : 'Switch to dark mode'} withArrow position="bottom">
      <ActionIcon
        variant="subtle"
        onClick={() => setColorScheme(dark ? 'light' : 'dark')}
        size="lg"
        aria-label="Toggle theme"
        className="hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors duration-200"
      >
        {dark ? <IconSun size={20} /> : <IconMoon size={20} />}
      </ActionIcon>
    </Tooltip>
  );
}

