#!/usr/bin/env ruby
# frozen_string_literal: true

require 'xcodeproj'

requested_paths = ARGV.select { |path| File.exist?(path) }
project_paths = (requested_paths + Dir['ios/*.xcodeproj'] + Dir['ios/Pods/*.xcodeproj']).uniq

raise 'No Xcode project found' if project_paths.empty?

def deduplicate_literal_flag(value, literal)
  return value if value.nil?

  tokens = value.is_a?(Array) ? value.dup : value.to_s.split(/\s+/)
  found = false
  filtered = tokens.each_with_object([]) do |token, result|
    if token == literal
      next if found

      found = true
    end
    result << token
  end

  value.is_a?(Array) ? filtered : filtered.join(' ')
end

def remove_literal_flag(value, literal)
  return value if value.nil?

  tokens = value.is_a?(Array) ? value.dup : value.to_s.split(/\s+/)
  filtered = tokens.reject { |token| token == literal }
  value.is_a?(Array) ? filtered : filtered.join(' ')
end

project_paths.uniq.each do |project_path|
  project = Xcodeproj::Project.open(project_path)
  changed = false

  project.targets.each do |target|
    target.build_configurations.each do |configuration|
      settings = configuration.build_settings
      {
        'GCC_TREAT_WARNINGS_AS_ERRORS' => 'NO',
        'SWIFT_TREAT_WARNINGS_AS_ERRORS' => 'NO',
        'CLANG_WARN_DOCUMENTATION_COMMENTS' => 'NO'
      }.each do |key, value|
        next if settings[key] == value

        settings[key] = value
        changed = true
      end

      %w[OTHER_CFLAGS OTHER_CPLUSPLUSFLAGS OTHER_SWIFT_FLAGS].each do |key|
        value = settings[key]
        next if value.nil?

        normalized = Array(value).reject do |flag|
          %w[-Werror -warnings-as-errors -fatal_warnings].include?(flag.to_s)
        end
        next if normalized == Array(value)

        settings[key] = value.is_a?(Array) ? normalized : normalized.join(' ')
        changed = true
      end

      next unless settings.key?('OTHER_LDFLAGS')

      normalized = if File.basename(project_path) == 'Pods.xcodeproj'
                     deduplicate_literal_flag(settings['OTHER_LDFLAGS'], '-lc++')
                   else
                     remove_literal_flag(settings['OTHER_LDFLAGS'], '-lc++')
                   end
      next if normalized == settings['OTHER_LDFLAGS']

      settings['OTHER_LDFLAGS'] = normalized
      changed = true
    end

    target.shell_script_build_phases.each do |phase|
      next unless phase.name.to_s.include?('[Hermes] Replace Hermes')
      next if phase.always_out_of_date == '1'

      phase.always_out_of_date = '1'
      changed = true
    end
  end

  unless File.basename(project_path) == 'Pods.xcodeproj'
    project.targets.each do |target|
      target.copy_files_build_phases.each do |phase|
        phase.files.dup.each do |build_file|
          reference = build_file.file_ref
          reference ||= build_file.product_ref if build_file.respond_to?(:product_ref)
          name = if reference
                   reference.respond_to?(:display_name) ? reference.display_name : reference.to_s
                 else
                   build_file.display_name
                 end
          next unless name.to_s.include?('ExpoModulesJSI')

          if phase.respond_to?(:remove_build_file)
            phase.remove_build_file(build_file)
          else
            phase.files.delete(build_file)
            build_file.remove_from_project
          end
          changed = true
          puts "Removed static ExpoModulesJSI from #{target.name} / #{phase.display_name}"
        end
      end
    end
  end

  if changed
    project.save
    puts "Prepared #{project_path}"
  else
    puts "No build-phase adjustment required for #{project_path}"
  end
end

# ExpoModulesJSI is a static archive whose code is already linked into the app.
# CocoaPods must not copy it into Payload/*.app/Frameworks, where signing tools
# would incorrectly treat the archive as a dynamic framework.
Dir['ios/Pods/Target Support Files/**/*frameworks*'].select { |path| File.file?(path) }.each do |path|
  content = File.binread(path)
  next unless content.include?('ExpoModulesJSI.framework')

  filtered = content.lines.reject { |line| line.include?('ExpoModulesJSI.framework') }.join
  File.binwrite(path, filtered)
  puts "Removed static ExpoModulesJSI embed entry from #{path}"
end

Dir['ios/**/*.xcconfig'].each do |xcconfig_path|
  content = File.read(xcconfig_path)
  changed = false
  normalized = content.lines.map do |line|
    match = line.match(/\A(\s*OTHER_LDFLAGS\s*=\s*)(.*?)(\r?\n)?\z/)
    next line unless match

    flags = deduplicate_literal_flag(match[2], '-lc++')
    next line if flags == match[2]

    changed = true
    "#{match[1]}#{flags}#{match[3]}"
  end.join

  next unless changed

  File.write(xcconfig_path, normalized)
  puts "Deduplicated -lc++ in #{xcconfig_path}"
end
