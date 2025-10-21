import React, { useState } from 'react';
import { Tabs, Container, Box } from '@mantine/core';
import { IconLink, IconCode } from '@tabler/icons-react';
import LinkCreator from './LinkCreator';
import SnippetShare from './SnippetShare';

export default function TabsContainer() {
  const [activeTab, setActiveTab] = useState<string | null>('links');

  return (
    <Container size="lg" className="w-full">
      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        variant="pills"
        radius="lg"
        className="w-full"
      >
        <Tabs.List
          grow
          className="mb-6 bg-gray-50 p-2 rounded-xl border border-gray-200"
        >
          <Tabs.Tab
            value="links"
            leftSection={<IconLink size={18} />}
            className="font-medium transition-all duration-200 data-[active]:bg-white data-[active]:shadow-sm"
          >
            URL Shortener
          </Tabs.Tab>
          <Tabs.Tab
            value="snippets"
            leftSection={<IconCode size={18} />}
            className="font-medium transition-all duration-200 data-[active]:bg-white data-[active]:shadow-sm"
          >
            Code Snippets
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="links">
          <Box className="animate-fade-in">
            <LinkCreator />
          </Box>
        </Tabs.Panel>

        <Tabs.Panel value="snippets">
          <Box className="animate-fade-in">
            <SnippetShare />
          </Box>
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}

