import React, { useEffect } from 'react';
import {
  MantineProvider,
  AppShell,
  Group,
  Title,
  Text,
  Container,
  Box,
  Anchor,
  Stack,
  Badge
} from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { IconBrandGithub, IconHeart, IconAlertCircle } from '@tabler/icons-react';
import LinkCreator from './LinkCreator';

export default function App() {
  useEffect(() => {
    // Check for expired link parameters in URL
    const urlParams = new URLSearchParams(window.location.search);
    const isExpired = urlParams.get('expired') === 'true';
    const expiredKey = urlParams.get('key');

    if (isExpired) {
      // Show notification for expired/non-existent link
      notifications.show({
        title: 'Link Not Found',
        message: expiredKey
          ? `The link "/${expiredKey}" may have expired or doesn't exist.`
          : 'The link you tried to access may have expired or doesn\'t exist.',
        color: 'orange',
        icon: <IconAlertCircle size={16} />,
        autoClose: 8000,
      });

      // Clean up URL parameters
      const newUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, newUrl);
    }
  }, []);

  return (
    <MantineProvider defaultColorScheme="light" theme={{ fontFamily: 'Inter, system-ui, sans-serif', primaryColor: 'blue' }}>
      <Notifications position="top-right" />
      <AppShell
        header={{ height: 70 }}
        footer={{ height: 60 }}
        padding="md"
        className="min-h-screen bg-white"
      >
        <AppShell.Header className="border-b border-gray-200 bg-white">
          <Group h="100%" px="sm" justify="space-between" className="sm:px-lg">
            <Group gap="xs" align="center" className="min-w-0 sm:gap-md">
              <Box className="flex items-center gap-2 sm:gap-3">
                <Title order={2} fw={800} className="text-lg sm:text-xl md:text-2xl truncate">
                  ShareThis.site
                </Title>
              </Box>
              <Badge variant="light" color="blue" size="sm" className="hidden sm:block">
                Beta
              </Badge>
            </Group>
            <Group gap="xs" className="sm:gap-md">
              <Anchor
                href="https://github.com/chark1es/sharethis"
                target="_blank"
                aria-label="Open GitHub repository in a new tab"
                className="text-gray-600 hover:text-gray-900 transition-colors duration-200"
              >
                <IconBrandGithub size={18} className="sm:w-5 sm:h-5" />
              </Anchor>
            </Group>
          </Group>
        </AppShell.Header>

        <AppShell.Main className="flex flex-col">
          <Container size="md" className="flex-1 px-4 sm:px-6">
            <Box ta="center" py="xl" className="animate-fade-in hero-ambient sm:py-2xl">
              <Stack gap="xl" align="center" className="sm:gap-2xl">
                <Stack gap="lg" align="center">
                  <Title order={1} fw={900} className="leading-tight text-2xl sm:text-3xl md:text-4xl lg:text-5xl px-2">
                    Simple, temporary links
                  </Title>
                  <Text
                    size="lg"
                    c="dimmed"
                    maw={600}
                    mx="auto"
                    className="leading-relaxed text-sm sm:text-base md:text-lg px-4 mt-4"
                  >
                    Create beautiful short-lived links like{' '}
                    <code className="bg-gray-100 px-2 py-1 rounded text-blue-600 font-mono text-xs sm:text-sm">
                      /tell
                    </code>{' '}
                    or{' '}
                    <code className="bg-gray-100 px-2 py-1 rounded text-purple-600 font-mono text-xs sm:text-sm">
                      /generate
                    </code>
                    . No account needed, just paste and share.
                  </Text>
                </Stack>

                <Group gap="sm" wrap="wrap" justify="center" className="mt-6 sm:mt-8 sm:gap-lg px-4">
                  <Badge variant="light" color="green" size="lg" className="px-4 py-2">
                    🔒 Secure
                  </Badge>
                  <Badge variant="light" color="blue" size="lg" className="px-4 py-2">
                    ⚡ Fast
                  </Badge>
                  <Badge variant="light" color="purple" size="lg" className="px-4 py-2">
                    🎯 Simple
                  </Badge>
                </Group>
              </Stack>
            </Box>

            <Box mt="2xl" className="animate-slide-up">
              <LinkCreator />
            </Box>
          </Container>
        </AppShell.Main>

        <AppShell.Footer className="border-t border-gray-200 bg-white">
          <Stack h="100%" px="md" align="center" justify="center" gap="sm" className="sm:hidden py-4">
            <Text size="xs" c="dimmed" ta="center">
              ©{new Date().getFullYear()} ShareThis.site - Temporary link shortener
            </Text>
            <Group gap="xs" align="center">
              <Text size="xs" c="dimmed">
                Made with
              </Text>
              <IconHeart size={12} className="text-red-500" />
              <Text size="xs" c="dimmed">
                for the web
              </Text>
            </Group>
          </Stack>
          <Group h="100%" px="xl" align="center" justify="between" className="hidden sm:flex">
            <Text size="sm" c="dimmed">
              ©{new Date().getFullYear()} ShareThis.site - Temporary link shortener
            </Text>
            <Group gap="xs" align="center">
              <Text size="sm" c="dimmed">
                Made with
              </Text>
              <IconHeart size={14} className="text-red-500" />
              <Text size="sm" c="dimmed">
                for the web
              </Text>
            </Group>
          </Group>
        </AppShell.Footer>
      </AppShell>
    </MantineProvider>
  );
}

